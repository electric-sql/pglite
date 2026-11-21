// Optional linked backend experiment. Called on a range-proven mixed loop.
#pragma once
#include "ir/iteration.h"
#include "wasm-builder.h"
#include <set>
#include <vector>

namespace paired {
using namespace wasm;
inline constexpr const char *symbol = "load_f32_pair_ordered";

inline void evaluationOrder(Expression *&e, std::vector<Expression **> &order) {
  for (auto &child : ChildIterator(e))
    evaluationOrder(child, order);
  order.push_back(&e);
}

// Only copy pure, nontrapping address arithmetic. The original tees still run
// at their original program points, including the tees of the second address.
inline Expression *address(Expression *e, Builder &ir,
                           std::set<Index> &inputs) {
  if (e->type != Type::i32)
    return nullptr;
  if (auto *g = e->dynCast<LocalGet>()) {
    inputs.insert(g->index);
    return ir.makeLocalGet(g->index, Type::i32);
  }
  if (auto *c = e->dynCast<Const>())
    return ir.makeConst(c->value);
  if (auto *s = e->dynCast<LocalSet>(); s && s->isTee())
    return address(s->value, ir, inputs);
  auto *b = e->dynCast<Binary>();
  if (!b || (b->op != AddInt32 && b->op != AndInt32 && b->op != OrInt32 &&
             b->op != ShlInt32))
    return nullptr;
  auto *left = address(b->left, ir, inputs);
  auto *right = address(b->right, ir, inputs);
  return left && right ? ir.makeBinary(b->op, left, right) : nullptr;
}

inline bool combine(Loop *mixed, Function *function, Module &mod,
                    const std::set<Load *> &provenPrivate) {
  Builder ir(mod);
  std::vector<Expression **> order;
  evaluationOrder(mixed->body, order);
  std::vector<size_t> shared;
  for (size_t i = 0; i < order.size(); ++i) {
    auto *load = (*order[i])->dynCast<Load>();
    if (!load || provenPrivate.count(load))
      continue;
    if (load->memory != mod.memories[1]->name || load->isAtomic ||
        load->type != Type::f32 || load->bytes != 4 || load->offset.addr)
      return false;
    shared.push_back(i);
  }
  if (shared.size() != 2)
    return false;
  auto *first = (*order[shared[0]])->cast<Load>();
  auto *second = (*order[shared[1]])->cast<Load>();
  std::set<Index> inputs;
  auto *next = address(second->ptr, ir, inputs);
  if (!next)
    return false;
  for (size_t i = shared[0] + 1; i < shared[1]; ++i) {
    Expression *op = *order[i];
    if (auto *s = op->dynCast<LocalSet>(); s && !inputs.count(s->index))
      continue;
    if (op->is<Const>() || op->is<LocalGet>())
      continue;
    if (auto *l = op->dynCast<Load>(); l && provenPrivate.count(l))
      continue;
    if (auto *b = op->dynCast<Binary>();
        b && (b->op == AddInt32 || b->op == OrInt32 || b->op == AndInt32 ||
              b->op == ShlInt32 || b->op == AddFloat32 || b->op == SubFloat32 ||
              b->op == MulFloat32))
      continue;
    if (auto *u = op->dynCast<Unary>(); u && u->op == AbsFloat32)
      continue;
    return false;
  }
  auto bits = Builder::addVar(function, Type::i64);
  auto *pair = ir.makeCall(symbol, {first->ptr, next}, Type::i64);
  auto asFloat = [&](Expression *word) {
    return ir.makeUnary(ReinterpretInt32, ir.makeUnary(WrapInt64, word));
  };
  *order[shared[0]] = asFloat(ir.makeLocalTee(bits, pair, Type::i64));
  *order[shared[1]] = ir.makeBlock(
      {ir.makeDrop(second->ptr),
       asFloat(ir.makeBinary(ShrUInt64, ir.makeLocalGet(bits, Type::i64),
                             ir.makeConst(int64_t(32))))},
      Type::f32);
  return true;
}
} // namespace paired
