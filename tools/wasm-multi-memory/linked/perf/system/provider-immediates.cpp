// Experimental final emitter for constant-offset scalar calls in a linked core.
#include "ir/find_all.h"
#include "wasm-builder.h"
#include "wasm-io.h"
#include "wasm-validator.h"
#include <iostream>
#include <map>

using namespace wasm;

struct Op {
  Name oldName;
  uint32_t offset;
};
using Operations = std::map<Name, Op>;

void save(Module &m, const char *path) {
  if (!WasmValidator().validate(m))
    throw std::runtime_error("invalid module");
  PassOptions options;
  ModuleWriter(options).write(m, path);
}

Operations specialize(Module &m) {
  Operations operations;
  std::map<Name, std::unique_ptr<Function>> imports;
  size_t sites = 0;
  for (auto &body : m.functions) {
    if (body->imported())
      continue;
    for (auto *call : FindAll<Call>(body->body).list) {
      auto *f = m.getFunction(call->target);
      if (f->module != "pgl_global" && f->module != "pgl_scoped")
        continue;
      auto name = f->base.toString();
      if ((name.rfind("load_", 0) != 0 && name.rfind("store_", 0) != 0) ||
          name.find("atomic") != std::string::npos || call->operands.empty())
        continue;
      auto *c = call->operands.back()->dynCast<Const>();
      if (!c || c->type != Type::i32)
        continue;
      uint32_t offset = c->value.geti32();
      if (offset > 32)
        continue;
      Name symbol(name + "_at_" + std::to_string(offset));
      Name target(f->module.toString() + "." + symbol.toString());
      if (!imports.count(target)) {
        std::vector<Type> args;
        for (size_t i = 0; i + 1 < call->operands.size(); ++i)
          args.push_back(f->getParams()[i]);
        auto fn = Builder::makeFunction(
            target, Signature(Type(args), f->getResults()), {}, nullptr);
        fn->module = f->module;
        fn->base = symbol;
        imports.emplace(target, std::move(fn));
        operations.emplace(symbol, Op{f->base, offset});
      }
      call->operands.pop_back();
      call->target = target;
      ++sites;
    }
  }
  for (auto &[name, fn] : imports)
    m.addFunction(std::move(fn));
  std::cout << sites << " constant-offset calls; " << operations.size()
            << " provider exports\n";
  return operations;
}

void extend(Module &m, const Operations &ops) {
  Builder ir(m);
  Name heap = m.memories.at(0)->name;
  for (const auto &[name, op] : ops) {
    auto *f = m.getFunction(m.getExport(op.oldName)->value);
    auto *ptr = ir.makeLocalGet(0, Type::i32);
    auto loads = FindAll<Load>(f->body).list;
    auto stores = FindAll<Store>(f->body).list;
    Expression *body;
    std::vector<Type> args{Type::i32};
    if (loads.size() == 1 && stores.empty()) {
      auto *l = loads.front();
      body = ir.makeLoad(l->bytes, l->signed_, op.offset, l->align, ptr,
                         l->type, heap);
    } else if (stores.size() == 1 && loads.empty()) {
      auto *s = stores.front();
      args.push_back(s->valueType);
      body = ir.makeStore(s->bytes, op.offset, s->align, ptr,
                          ir.makeLocalGet(1, s->valueType), s->valueType, heap);
    } else
      throw std::runtime_error("unknown scalar provider implementation");
    m.addFunction(Builder::makeFunction(
        name, Signature(Type(args), f->getResults()), {}, body));
    m.addExport(Builder::makeExport(name, name, ExternalKind::Function));
  }
  // The two 32-bit reads retain their Wasm evaluation order. In particular a
  // wide load would change shared-memory access width and boundary behavior.
  auto word = [&](Index i) {
    return ir.makeUnary(ExtendUInt32, ir.makeLoad(4, false, 0, 4,
                                                  ir.makeLocalGet(i, Type::i32),
                                                  Type::i32, heap));
  };
  auto *bits = ir.makeBinary(
      OrInt64, word(0),
      ir.makeBinary(ShlInt64, word(1), ir.makeConst(int64_t(32))));
  Name pair("load_f32_pair_ordered");
  m.addFunction(Builder::makeFunction(
      pair, Signature(Type({Type::i32, Type::i32}), Type::i64), {}, bits));
  m.addExport(Builder::makeExport(pair, pair, ExternalKind::Function));
}

int main(int argc, char **argv) {
  try {
    if (argc != 7)
      throw std::runtime_error("expected input/output pairs for core, shared "
                               "provider and unshared provider");
    Module core;
    ModuleReader().read(argv[1], core);
    auto ops = specialize(core);
    save(core, argv[2]);
    for (int i : {3, 5}) {
      Module provider;
      ModuleReader().read(argv[i], provider);
      provider.features.setAll();
      extend(provider, ops);
      save(provider, argv[i + 1]);
    }
  } catch (const std::exception &e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}
