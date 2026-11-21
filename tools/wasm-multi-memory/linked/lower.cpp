// Final lowering of the pointer-provenance pass. Memory 0 remains local.
// Global and scoped operations call exports of an instance bound to one heap.
#include "ir/iteration.h"
#include "pass.h"
#include "wasm-builder.h"
#include "wasm-io.h"
#include "wasm-traversal.h"
#include "wasm-validator.h"
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

using namespace wasm;
namespace {
const Name heap("heap");
const char *domains[] = {"private", "pgl_global", "pgl_scoped"};

std::string typeName(Type t) {
  std::ostringstream out;
  out << t;
  return out.str();
}

struct Lower : PostWalker<Lower> {
  Module &mod, &provider;
  Builder ir, abi;
  Name memories[3];
  Name privateFloatRead;
  const bool fixedABI;
  size_t routed = 0;
  Lower(Module &m, Module &p, bool fixedABI)
      : mod(m), provider(p), ir(m), abi(p), fixedABI(fixedABI) {
    if (m.memories.size() != 3)
      throw std::runtime_error("expected pointer-domain IR");
    for (size_t i = 0; i < 3; ++i)
      memories[i] = m.memories[i]->name;
    if (m.memories[0]->base != "memory" ||
        m.memories[1]->base != "global_memory" ||
        m.memories[2]->base != "scoped_memory")
      throw std::runtime_error("unexpected memory ABI");
    for (auto &function : m.functions) {
      if (function->module == "env" &&
          function->base == "pgl_private_read_f32") {
        if (function->getParams() != Type::i32 ||
            function->getResults() != Type::f32)
          throw std::runtime_error("invalid private float load signature");
        privateFloatRead = function->name;
      }
    }
  }
  int domain(Name memory) {
    for (int i = 0; i < 3; ++i)
      if (memory == memories[i])
        return i;
    throw std::runtime_error("unknown memory");
  }
  void call(std::string ns, std::string symbol, std::vector<Type> params,
            Type result, std::vector<Expression *> args) {
    Name name(ns + "." + symbol);
    if (!mod.getFunctionOrNull(name)) {
      auto f = Builder::makeFunction(name, Signature(Type(params), result), {},
                                     nullptr);
      f->module = ns;
      f->base = symbol;
      mod.addFunction(std::move(f));
    }
    replaceCurrent(ir.makeCall(name, args, result));
    ++routed;
  }
  void operate(Expression *op, Name &memory, std::string symbol,
               Address *immediate = nullptr) {
    int d = domain(memory);
    if (!d)
      return;
    std::vector<Type> params;
    std::vector<Expression *> args;
    ChildIterator children(op);
    for (auto *child : children) {
      if (!child->type.isConcrete())
        throw std::runtime_error("unexpected polymorphic operand in " + symbol);
      params.push_back(child->type);
      args.push_back(child);
    }
    if (immediate) {
      args.push_back(ir.makeConst(uint32_t(immediate->addr)));
      params.push_back(Type::i32);
      *immediate = 0;
    }
    if (fixedABI) {
      auto *exported = provider.getExportOrNull(symbol);
      if (!exported || exported->kind != ExternalKind::Function ||
          provider.getFunction(exported->value)->type.getSignature() !=
              Signature(Type(params), op->type))
        throw std::runtime_error("unsupported linked-wasm32-v1 operation: " +
                                 symbol);
    } else if (!provider.getFunctionOrNull(symbol)) {
      Index index = 0;
      for (auto &child : children) {
        child = abi.makeLocalGet(index, params[index]);
        ++index;
      }
      memory = heap;
      Expression *guard = nullptr;
      if (immediate) {
        auto sum = [&]() {
          return abi.makeBinary(AddInt32, abi.makeLocalGet(0, Type::i32),
                                abi.makeLocalGet(params.size() - 1, Type::i32));
        };
        *children.begin() = sum();
        guard = abi.makeIf(
            abi.makeBinary(LtUInt32, sum(), abi.makeLocalGet(0, Type::i32)),
            abi.makeUnreachable());
      }
      auto *body = ExpressionManipulator::copy(op, provider);
      if (guard)
        body = abi.makeBlock({guard, body}, op->type);
      auto f = Builder::makeFunction(symbol, Signature(Type(params), op->type),
                                     {}, body);
      provider.addFunction(std::move(f));
      provider.addExport(
          Builder::makeExport(symbol, symbol, ExternalKind::Function));
    }
    call(domains[d], symbol, params, op->type, args);
  }
  void visitCall(Call *call) {
    if (privateFloatRead.is() && call->target == privateFloatRead) {
      // A tagged address is beyond the private heap's 2 GiB limit and traps.
      auto *load = ir.makeLoad(4, false, 0, 4, call->operands[0], Type::f32,
                               memories[0]);
      replaceCurrent(call->isReturn
                         ? static_cast<Expression *>(ir.makeReturn(load))
                         : load);
    }
  }
  void visitLoad(Load *x) {
    operate(x, x->memory,
            "load_" + typeName(x->type) + "_" + std::to_string(x->bytes) +
                (x->signed_ ? "s" : "u") + (x->isAtomic ? "_atomic" : ""),
            &x->offset);
  }
  void visitStore(Store *x) {
    operate(x, x->memory,
            "store_" + typeName(x->valueType) + "_" + std::to_string(x->bytes) +
                (x->isAtomic ? "_atomic" : ""),
            &x->offset);
  }
  void visitAtomicRMW(AtomicRMW *x) {
    operate(x, x->memory,
            "rmw_" + typeName(x->type) + "_" + std::to_string(x->bytes) + "_" +
                std::to_string(x->op),
            &x->offset);
  }
  void visitAtomicCmpxchg(AtomicCmpxchg *x) {
    operate(x, x->memory,
            "cmpxchg_" + typeName(x->type) + "_" + std::to_string(x->bytes),
            &x->offset);
  }
  void visitAtomicWait(AtomicWait *x) {
    operate(x, x->memory, "wait_" + typeName(x->expectedType), &x->offset);
  }
  void visitAtomicNotify(AtomicNotify *x) {
    operate(x, x->memory, "notify", &x->offset);
  }
  void visitSIMDLoad(SIMDLoad *x) {
    operate(x, x->memory, "simd_" + std::to_string(x->op), &x->offset);
  }
  void visitSIMDLoadStoreLane(SIMDLoadStoreLane *x) {
    operate(x, x->memory,
            "lane_" + std::to_string(x->op) + "_" + std::to_string(x->index),
            &x->offset);
  }
  void visitMemorySize(MemorySize *x) { operate(x, x->memory, "size"); }
  void visitMemoryGrow(MemoryGrow *x) { operate(x, x->memory, "grow"); }
  void visitMemoryFill(MemoryFill *x) { operate(x, x->memory, "fill"); }
  void visitMemoryCopy(MemoryCopy *x) {
    int dst = domain(x->destMemory), src = domain(x->sourceMemory);
    if (dst != src) {
      call("pgl_bulk", "copy" + std::to_string(dst) + std::to_string(src),
           {Type::i32, Type::i32, Type::i32}, Type::none,
           {x->dest, x->source, x->size});
    } else if (dst) {
      x->sourceMemory = heap;
      operate(x, x->destMemory, "copy");
    }
  }
};

void write(Module &m, const std::string &filename) {
  if (!WasmValidator().validate(m))
    throw std::runtime_error("invalid output " + filename);
  PassOptions opts;
  ModuleWriter writer(opts);
  writer.write(m, filename);
}
} // namespace

int main(int argc, char **argv) {
  try {
    if (argc != 4)
      throw std::runtime_error(
          "usage: lower INPUT_OUTPUT_LIST SHARED_PROVIDER UNSHARED_PROVIDER");
    Module provider;
    auto mem = std::make_unique<Memory>();
    mem->name = heap;
    mem->module = "env";
    mem->base = "memory";
    mem->initial = 0;
    mem->max = 32768;
    mem->shared = true;
    provider.addMemory(std::move(mem));
    bool standalone = std::string(argv[1]) == "--sdk";
    if (standalone) {
      provider.removeMemory(heap);
      ModuleReader().read("/opt/pglite-linked/linked-shared.wasm", provider);
    }
    std::ifstream list;
    if (!standalone) {
      list.open(argv[1]);
      if (!list)
        throw std::runtime_error("cannot open input list");
    }
    std::string input, output;
    while (standalone || (list >> input >> output)) {
      if (standalone) {
        input = argv[2];
        output = argv[3];
      }
      Module m;
      ModuleReader reader;
      reader.read(input, m);
      Lower lower(m, provider, standalone);
      std::vector<Function *> funcs;
      for (auto &f : m.functions)
        if (!f->imported())
          funcs.push_back(f.get());
      for (auto *f : funcs)
        lower.walkFunction(f);
      if (lower.privateFloatRead.is())
        m.removeFunction(lower.privateFloatRead);
      m.removeMemory(lower.memories[1]);
      m.removeMemory(lower.memories[2]);
      m.memories[0]->shared = false;
      m.features.setMultiMemory(false);
      provider.features.enable(m.features);
      for (auto &section : m.customSections)
        if (section.name == "pglite.multi-memory.abi") {
          section.name = "pglite.linked-memory.abi";
          std::string abi = "pglite-linked-wasm32-v1";
          section.data.assign(abi.begin(), abi.end());
        }
      write(m, output);
      if (standalone)
        return 0;
      std::cout << input << " linked accesses: " << lower.routed << std::endl;
    }
    // A multi-value result transports eight words without widening the shared
    // reads.
    Builder ops(provider);
    auto pair = [&](Index first) {
      auto word = [&](Index index) {
        return ops.makeUnary(ExtendUInt32,
                             ops.makeLoad(4, false, 4 * (index ^ 1), 4,
                                          ops.makeLocalGet(0, Type::i32),
                                          Type::i32, heap));
      };
      return ops.makeBinary(OrInt64, word(first),
                            ops.makeBinary(ShlInt64, word(first + 1),
                                           ops.makeConst(int64_t(32))));
    };
    provider.features.setMultivalue(true);
    Name orderedReads("load_f32x8_ordered_v1");
    provider.addFunction(Builder::makeFunction(
        orderedReads,
        Signature(Type::i32, Type(std::vector<Type>(4, Type::i64))), {},
        ops.makeTupleMake(
            std::vector<Expression *>{pair(0), pair(2), pair(4), pair(6)})));
    provider.addExport(Builder::makeExport(orderedReads, orderedReads,
                                           ExternalKind::Function));
    write(provider, argv[2]);
    provider.memories[0]->shared = false;
    write(provider, argv[3]);
  } catch (const std::exception &e) {
    std::cerr << e.what() << std::endl;
    return 1;
  }
}
