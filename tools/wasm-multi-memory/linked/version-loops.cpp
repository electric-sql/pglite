// Version counted loops in the optimized pointer-domain IR, before choosing a
// native or linked memory backend. The original loop is the fallback.
#include "ir/find_all.h"
#include "ir/label-utils.h"
#include "ir/utils.h"
#include "ordered-loads.h"
#include "pair-loads.h"
#include "pass.h"
#include "wasm-builder.h"
#include "wasm-io.h"
#include "wasm-validator.h"
#include <algorithm>
#include <iostream>
#include <map>
#include <optional>
#include <set>

using namespace wasm;
namespace {

bool integer(Expression *e, uint32_t &value) {
  if (auto *c = e->dynCast<Const>(); c && c->type == Type::i32) {
    value = c->value.geti32();
    return true;
  }
  return false;
}

// Recognize exactly one self-increment of a local by a positive power of two.
uint32_t increment(LocalSet *set) {
  if (!set)
    return 0;
  auto *add = set->value->dynCast<Binary>();
  if (!add || add->op != AddInt32)
    return 0;
  auto *from = add->left->dynCast<LocalGet>();
  uint32_t step;
  if (!from || from->index != set->index || !integer(add->right, step) ||
      step == 0 || step > 1024 || (step & (step - 1)))
    return 0;
  return step;
}

// On the guarded path an address is between base and base + index*scale +
// extra. A missing base denotes an unsigned offset. Unsupported expressions
// have no bound.
struct Range {
  std::optional<Index> base;
  uint64_t scale = 0;
  uint64_t extra = 0;
};
using Bound = std::optional<Range>;

// Match the SDK's canonical f32 routing helper before replacing its global
// arm. A different helper may have side effects or different trap semantics.
std::set<Name> findFloatReaders(Module &m) {
  Builder ir(m);
  auto ptr = [&] { return ir.makeLocalGet(0, Type::i32); };
  auto mask = [&](uint32_t bits) {
    return ir.makeBinary(AndInt32, ptr(), ir.makeConst(bits));
  };
  auto domain = [&](uint32_t tag) {
    return ir.makeBinary(EqInt32, mask(0xc0000000), ir.makeConst(tag));
  };
  auto shared = [&](size_t heap) {
    auto *over =
        ir.makeBinary(GtUInt32, mask(0x3fffffff), ir.makeConst(0x3ffffffc));
    auto *load = ir.makeLoad(4, false, 0, 4, mask(0x3fffffff), Type::f32,
                             m.memories[heap]->name);
    return ir.makeBlock({ir.makeIf(over, ir.makeUnreachable()), load},
                        Type::f32);
  };
  auto *priv =
      ir.makeLoad(4, false, 0, 4, ptr(), Type::f32, m.memories[0]->name);
  auto *route = ir.makeIf(domain(0xc0000000), shared(2),
                          ir.makeIf(domain(0x80000000), shared(1), priv));
  auto *body = ir.makeBlock(
      {ir.makeIf(ir.makeUnary(EqZInt32, ptr()), ir.makeUnreachable()), route},
      Type::f32);
  std::set<Name> result;
  for (auto &f : m.functions)
    if (!f->imported() && f->getParams() == Type::i32 &&
        f->getResults() == Type::f32 &&
        ExpressionAnalyzer::equal(f->body, body))
      result.insert(f->name);
  return result;
}

struct Site {
  Index base;
  Load *load;
  Name reader;
};

struct Addresses {
  Name memory;
  Index induction;
  std::map<Index, unsigned> &writes;
  std::map<Index, Bound> locals;
  std::map<Index, Range> spans;
  std::vector<Site> sites;
  bool supported = true;

  Bound evaluate(Expression *&e) {
    if (auto *get = e->dynCast<LocalGet>()) {
      if (get->type != Type::i32)
        return {};
      if (get->index == induction)
        return Range{{}, 1, 0};
      if (!writes.count(get->index))
        return Range{get->index, 0, 0};
      return locals[get->index]; // Assigned before use in this iteration.
    }
    if (auto *set = e->dynCast<LocalSet>()) {
      auto value = evaluate(set->value);
      locals[set->index] = value;
      return value;
    }
    if (e->is<Const>()) {
      uint32_t value;
      if (integer(e, value))
        return Range{{}, 0, value};
      return {};
    }
    if (auto *u = e->dynCast<Unary>()) {
      evaluate(u->value);
      return {};
    }
    if (auto *op = e->dynCast<Binary>()) {
      auto a = evaluate(op->left);
      auto b = evaluate(op->right);
      if (!a || !b)
        return {};
      uint32_t imm;
      if (op->op == AddInt32 && !(a->base && b->base)) {
        a = Range{a->base ? a->base : b->base, a->scale + b->scale,
                  a->extra + b->extra};
      } else if (integer(op->right, imm) && op->op == OrInt32) {
        // For unsigned x, x <= (x | imm) <= x + imm.
        a->extra += imm;
      } else if (integer(op->right, imm) && op->op == ShlInt32 && imm <= 8 &&
                 !a->base) {
        a->scale <<= imm;
        a->extra <<= imm;
      } else {
        return {};
      }
      // Bound compiler-side arithmetic as well as the generated i64 guard.
      if (a->scale > 65536 || a->extra > UINT32_MAX)
        return {};
      return a;
    }
    if (auto *branch = e->dynCast<If>()) {
      auto *test = branch->condition->dynCast<Binary>();
      auto *load = branch->ifTrue->dynCast<Load>();
      uint32_t zero;
      if (test && test->op == GtSInt32 && integer(test->right, zero) && !zero &&
          load && !load->isAtomic && load->memory == memory &&
          load->type == Type::f32 && load->bytes == 4 &&
          load->ptr->is<LocalGet>()) {
        auto *address = test->left;
        auto index = load->ptr->cast<LocalGet>()->index;
        auto *get = address->dynCast<LocalGet>();
        auto *tee = address->dynCast<LocalSet>();
        if ((get && get->index == index) ||
            (tee && tee->isTee() && tee->index == index)) {
          auto range = evaluate(test->left);
          if (range && range->base && load->offset.addr <= UINT32_MAX) {
            auto &span = spans[*range->base];
            span.scale = std::max(span.scale, range->scale);
            span.extra = std::max(span.extra, range->extra + load->offset.addr +
                                                  load->bytes);
            // Preserve the address evaluation, including any nested local.tee.
            load->ptr = test->left;
            e = load;
            auto *call =
                branch->ifFalse ? branch->ifFalse->dynCast<Call>() : nullptr;
            Name reader;
            if (call && !call->isReturn && call->operands.size() == 1 &&
                !load->offset.addr) {
              auto *arg = call->operands[0]->dynCast<LocalGet>();
              if (arg && arg->index == index)
                reader = call->target;
            }
            sites.push_back({*range->base, load, reader});
            return {};
          }
        }
      }
    }
    supported = false;
    return {};
  }
};

struct Versioner : PostWalker<Versioner> {
  Builder ir;
  Module &module;
  Name memory;
  LabelUtils::LabelManager labels;
  const std::set<Name> &readers;
  Function *function;
  bool pairLoads, orderedLoads;
  size_t groups = 0;
  size_t loops = 0, loads = 0, mixedLoops = 0, pairs = 0;
  Versioner(Module &module, Function *f, const std::set<Name> &readers,
            bool pairLoads, bool orderedLoads)
      : ir(module), module(module), memory(module.memories[0]->name), labels(f),
        readers(readers), function(f), pairLoads(pairLoads),
        orderedLoads(orderedLoads) {}

  void visitLoop(Loop *loop) {
    auto *body = loop->body->dynCast<Block>();
    if (!body || body->name.is() || body->list.size() < 2 ||
        loop->type != Type::none)
      return;
    auto *back = body->list.back()->dynCast<Break>();
    if (!back || back->value || !back->condition || back->name != loop->name)
      return;
    auto *test = back->condition->dynCast<Binary>();
    if (!test || test->op != NeInt32)
      return;
    auto *latch = test->left->dynCast<LocalSet>();
    auto *end = test->right->dynCast<LocalGet>();
    uint32_t step = increment(latch);
    if (!step || !end)
      return;
    std::map<Index, unsigned> writes;
    for (auto *set : FindAll<LocalSet>(body).list)
      ++writes[set->index];
    if (writes.count(end->index) || writes[latch->index] != 1)
      return;
    Index index = latch->index;
    size_t stop = body->list.size() - 1;
    if (auto *second = body->list[stop - 1]->dynCast<LocalSet>();
        increment(second) == step && writes[second->index] == 1) {
      index = second->index;
      --stop;
    }

    auto *fast = ExpressionManipulator::copy(loop, module)->cast<Loop>();
    auto *flat = fast->body->cast<Block>();
    Addresses scan{memory, index, writes};
    for (size_t i = 0; i < stop && scan.supported; ++i)
      scan.evaluate(flat->list[i]);
    if (!scan.supported || scan.sites.empty())
      return;

    auto local = [&](Index i) { return ir.makeLocalGet(i, Type::i32); };
    auto widen = [&](Index i) { return ir.makeUnary(ExtendUInt32, local(i)); };
    auto guardFor = [&](std::optional<Index> globalBase,
                        bool checkBounds = false) {
      Expression *guard = ir.makeUnary(EqZInt32, local(index));
      auto require = [&](Expression *c) {
        guard = ir.makeBinary(AndInt32, guard, c);
      };
      if (index != latch->index)
        require(ir.makeUnary(EqZInt32, local(latch->index)));
      require(ir.makeBinary(GeUInt32, local(end->index), ir.makeConst(step)));
      if (step > 1)
        require(
            ir.makeUnary(EqZInt32, ir.makeBinary(AndInt32, local(end->index),
                                                 ir.makeConst(step - 1))));
      for (const auto &[base, span] : scan.spans) {
        // Both induction variables start at zero and reach end exactly. The
        // last iteration starts at end-step. All range arithmetic is widened.
        auto *last = ir.makeBinary(SubInt64, widen(end->index),
                                   ir.makeConst(int64_t(step)));
        auto *bytes =
            ir.makeBinary(MulInt64, last, ir.makeConst(int64_t(span.scale)));
        auto *limit =
            ir.makeBinary(AddInt64, ir.makeBinary(AddInt64, widen(base), bytes),
                          ir.makeConst(int64_t(span.extra)));
        bool global = globalBase == base;
        if (checkBounds && !global) {
          auto *pages = ir.makeUnary(ExtendUInt32, ir.makeMemorySize(memory));
          auto *bytes =
              ir.makeBinary(ShlInt64, pages, ir.makeConst(int64_t(16)));
          require(ir.makeBinary(
              LeUInt64, ExpressionManipulator::copy(limit, module), bytes));
        }
        if (global)
          require(ir.makeBinary(GeUInt32, local(base),
                                ir.makeConst(uint32_t(0x80000000))));
        else
          require(
              ir.makeBinary(GtSInt32, local(base), ir.makeConst(int32_t(0))));
        require(ir.makeBinary(
            LeUInt64, limit,
            ir.makeConst(int64_t(global ? 0xc0000000u : 0x80000000u))));
      }
      return guard;
    };
    auto nameLoop = [&](Loop *version, const char *name) {
      version->name = labels.getUnique(name);
      version->body->cast<Block>()->list.back()->cast<Break>()->name =
          version->name;
    };
    nameLoop(fast, "private_loop");
    Expression *fallback = loop;
    if (!readers.empty() && scan.spans.size() == 2) {
      // Specialize the second distinct input stream in evaluation order.
      Index first = scan.sites.front().base;
      Index other = std::find_if(scan.sites.begin(), scan.sites.end(),
                                 [&](const Site &s) { return s.base != first; })
                        ->base;
      if (std::all_of(scan.sites.begin(), scan.sites.end(), [&](const Site &s) {
            return s.base != other || readers.count(s.reader);
          })) {
        auto *mixed = ExpressionManipulator::copy(loop, module)->cast<Loop>();
        Addresses direct{memory, index, writes};
        for (size_t i = 0; i < stop; ++i)
          direct.evaluate(mixed->body->cast<Block>()->list[i]);
        for (auto &site : direct.sites) {
          if (site.base != other)
            continue;
          site.load->memory = module.memories[1]->name;
          site.load->ptr =
              ir.makeBinary(AndInt32, site.load->ptr, ir.makeConst(0x3fffffff));
        }
        std::set<Load *> privateSites;
        if (pairLoads)
          for (const auto &site : direct.sites)
            if (site.base != other)
              privateSites.insert(site.load);
        bool paired =
            pairLoads && paired::combine(mixed, function, module, privateSites);
        if (paired)
          ++pairs;
        nameLoop(mixed, "mixed_loop");
        fallback = ir.makeIf(guardFor(other, paired), mixed, loop);
        if (orderedLoads) {
          if (auto *wide =
                  ordered::unroll(module, function, mixed, index, step)) {
            nameLoop(wide, "eight_read_loop");
            auto *wholeGroups = ir.makeUnary(
                EqZInt32, ir.makeBinary(AndInt32, local(end->index),
                                        ir.makeConst(4 * step - 1)));
            fallback = ir.makeIf(
                ir.makeBinary(AndInt32, guardFor(other, true), wholeGroups),
                wide, fallback);
            ++groups;
          }
        }
        ++mixedLoops;
      }
    }
    replaceCurrent(ir.makeIf(guardFor({}), fast, fallback));
    ++loops;
    loads += scan.sites.size();
  }
};
} // namespace

int main(int argc, char **argv) {
  try {
    bool pairLoads = argc == 4 && std::string(argv[3]) == "--pair-linked";
    bool orderedLoads = argc == 4 && std::string(argv[3]) == "--ordered-linked";
    bool mixed = orderedLoads || pairLoads ||
                 (argc == 4 && std::string(argv[3]) == "--mixed");
    if (argc != 3 && !mixed)
      throw std::runtime_error("usage: version-loops DOMAIN_IR OUTPUT "
                               "[--mixed|--pair-linked|--ordered-linked]");
    Module module;
    ModuleReader().read(argv[1], module);
    if (module.memories.size() != 3 || module.memories[0]->base != "memory" ||
        module.memories[1]->base != "global_memory" ||
        module.memories[2]->base != "scoped_memory" ||
        std::any_of(module.memories.begin(), module.memories.end(),
                    [](const auto &memory) { return memory->is64(); }))
      throw std::runtime_error("expected PGlite wasm32 pointer-domain IR");
    const auto readers = mixed ? findFloatReaders(module) : std::set<Name>{};
    if (pairLoads) {
      if (module.getFunctionOrNull(paired::symbol))
        throw std::runtime_error("pair symbol collision");
      auto fn = Builder::makeFunction(
          paired::symbol, Signature(Type({Type::i32, Type::i32}), Type::i64),
          {}, nullptr);
      fn->module = "pgl_global";
      fn->base = paired::symbol;
      module.addFunction(std::move(fn));
    }
    if (orderedLoads) {
      if (module.getFunctionOrNull(ordered::symbol))
        throw std::runtime_error("ordered symbol collision");
      module.features.setMultivalue(true);
      auto fn = Builder::makeFunction(ordered::symbol,
                                      Signature(Type::i32, ordered::result()),
                                      {}, nullptr);
      fn->module = "pgl_global";
      fn->base = ordered::symbol;
      module.addFunction(std::move(fn));
    }
    size_t allPairs = 0, allGroups = 0;
    for (auto &f : module.functions) {
      if (f->imported())
        continue;
      Versioner pass(module, f.get(), readers, pairLoads, orderedLoads);
      pass.walkFunction(f.get());
      allPairs += pass.pairs;
      allGroups += pass.groups;
      if (pass.loops) {
        std::cout << f->name << " " << pass.loops << " loops " << pass.loads
                  << " guarded loads";
        for (auto &ex : module.exports)
          if (ex->kind == ExternalKind::Function && ex->value == f->name)
            std::cout << " " << ex->name;
        if (mixed)
          std::cout << " mixed=" << pass.mixedLoops;
        if (orderedLoads)
          std::cout << " groups=" << pass.groups;
        if (pairLoads)
          std::cout << " pairs=" << pass.pairs;
        std::cout << '\n';
      }
    }
    if (orderedLoads && !allGroups)
      module.removeFunction(ordered::symbol);
    if (pairLoads && !allPairs)
      module.removeFunction(paired::symbol);
    if (!WasmValidator().validate(module))
      throw std::runtime_error("invalid versioned module");
    PassOptions options;
    ModuleWriter(options).write(module, argv[2]);
  } catch (const std::exception &e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}
