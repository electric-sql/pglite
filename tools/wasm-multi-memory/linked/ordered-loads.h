#pragma once
#include "ir/utils.h"
#include "wasm-builder.h"
#include <map>
#include <optional>

namespace ordered {
using namespace wasm;
inline constexpr const char *symbol = "load_f32x8_ordered_v1";
inline Type result() {
  return Type({Type::i64, Type::i64, Type::i64, Type::i64});
}

// Symbolically evaluate integer addresses at loop entry. The copied iterations
// retain all local assignments and the original floating point evaluation.
struct Addresses {
  Module &module;
  Builder ir;
  std::map<Index, Expression *> values;
  std::vector<Expression **> loads;
  std::vector<Expression *> args;
  bool valid = true;
  unsigned budget = 512;

  Expression *visit(Expression *&e) {
    if (!budget || !valid) {
      valid = false;
      return nullptr;
    }
    --budget;
    if (auto *get = e->dynCast<LocalGet>()) {
      if (get->type != Type::i32)
        return nullptr;
      auto found = values.find(get->index);
      return found == values.end() ? ir.makeLocalGet(get->index, Type::i32)
                                   : found->second;
    }
    if (auto *literal = e->dynCast<Const>())
      return literal->type == Type::i32 ? ir.makeConst(literal->value)
                                        : nullptr;
    if (auto *set = e->dynCast<LocalSet>()) {
      auto *v = visit(set->value);
      values[set->index] = v;
      return set->isTee() ? v : nullptr;
    }
    if (auto *drop = e->dynCast<Drop>()) {
      visit(drop->value);
      return nullptr;
    }
    if (auto *load = e->dynCast<Load>()) {
      auto *addr = visit(load->ptr);
      if (load->isAtomic || load->bytes != 4 || load->type != Type::f32)
        valid = false;
      if (load->memory == module.memories[1]->name) {
        if (!addr || load->offset.addr)
          valid = false;
        loads.push_back(&e);
        args.push_back(addr);
      } else if (load->memory != module.memories[0]->name)
        valid = false;
      return nullptr;
    }
    if (auto *binary = e->dynCast<Binary>()) {
      auto *left = visit(binary->left);
      auto *right = visit(binary->right);
      switch (binary->op) {
      case AddInt32:
      case AndInt32:
      case OrInt32:
      case ShlInt32:
        return left && right ? ir.makeBinary(binary->op, left, right) : nullptr;
      case AddFloat32:
      case SubFloat32:
      case MulFloat32:
        return nullptr;
      default:
        break;
      }
    } else if (auto *unary = e->dynCast<Unary>();
               unary && unary->op == AbsFloat32) {
      visit(unary->value);
      return nullptr;
    }
    valid = false;
    return nullptr;
  }
};

// Locals can represent shared expression subtrees. Bound their expanded cost
// before making independent IR trees for the call operands.
inline bool withinBudget(Expression *e, unsigned &budget) {
  if (!budget)
    return false;
  --budget;
  for (auto *child : ChildIterator(e))
    if (!withinBudget(child, budget))
      return false;
  return true;
}

// Compare address expressions modulo wasm32. The induction variable starts at
// zero and advances by a known power of two, so some ORs are additions.
struct Affine {
  std::map<Index, uint32_t> terms;
  uint32_t offset = 0;
};
inline std::optional<Affine> affine(Expression *e, Index induction,
                                    uint32_t step) {
  if (auto *c = e->dynCast<Const>())
    return Affine{{}, uint32_t(c->value.geti32())};
  if (auto *get = e->dynCast<LocalGet>())
    return Affine{{{get->index, 1}}, 0};
  auto *b = e->dynCast<Binary>();
  if (!b)
    return {};
  auto left = affine(b->left, induction, step),
       right = affine(b->right, induction, step);
  if (!left || !right)
    return {};
  if (b->op == ShlInt32 && right->terms.empty()) {
    auto shift = right->offset & 31;
    for (auto &[index, factor] : left->terms)
      factor <<= shift;
    left->offset <<= shift;
  } else if (b->op == AddInt32) {
    for (auto &[index, factor] : right->terms)
      left->terms[index] += factor;
    left->offset += right->offset;
  } else if (b->op == OrInt32 && right->terms.empty()) {
    uint32_t alignment = 0;
    for (auto &[index, factor] : left->terms)
      alignment |= factor * (index == induction ? step : 1);
    uint32_t known = (alignment & -alignment) - 1;
    if (right->offset & ~known)
      return {};
    left->offset |= right->offset;
  } else
    return {};
  return left;
}
inline Loop *unroll(Module &module, Function *function, Loop *mixed,
                    Index induction, uint32_t step) {
  Builder ir(module);
  auto copy = [&](Expression *e) {
    return ExpressionManipulator::copy(e, module);
  };
  auto *body = mixed->body->cast<Block>();
  auto *back = body->list.back()->cast<Break>();
  std::vector<Expression *> statements;
  for (unsigned iteration = 0; iteration < 4; ++iteration) {
    for (size_t i = 0; i + 1 < body->list.size(); ++i)
      statements.push_back(copy(body->list[i]));
    if (iteration < 3)
      statements.push_back(
          ir.makeDrop(copy(back->condition->cast<Binary>()->left)));
  }
  Addresses addresses{module, Builder(module)};
  for (auto &statement : statements)
    addresses.visit(statement);
  if (!addresses.valid || addresses.args.size() != 8)
    return nullptr;
  // Snapshot address expressions only. Each shared word is loaded separately
  // in original program order. The caller has proved all private reads in
  // bounds.
  unsigned addressBudget = 256;
  for (auto *&arg : addresses.args) {
    if (!withinBudget(arg, addressBudget))
      return nullptr;
    arg = copy(arg);
  }
  // The provider takes the lowest address. Its memargs preserve the compiler's
  // high/low order within each pair, including at the end of the shared heap.
  std::optional<Affine> first;
  for (size_t lane = 0; lane < addresses.args.size(); ++lane) {
    auto *mask = addresses.args[lane]->dynCast<Binary>();
    if (!mask || mask->op != AndInt32 || !mask->right->is<Const>() ||
        mask->right->cast<Const>()->value.geti32() != 0x3fffffff)
      return nullptr;
    auto addr = affine(mask->left, induction, step);
    if (!addr)
      return nullptr;
    if (!first)
      first = addr;
    if (addr->terms != first->terms ||
        addr->offset != uint32_t(first->offset - 4 + 4 * (lane ^ 1)))
      return nullptr;
  }
  Index packed = Builder::addVar(function, result());
  for (size_t lane = 0; lane < 8; ++lane) {
    auto **site = addresses.loads[lane];
    Expression *bits =
        ir.makeTupleExtract(ir.makeLocalGet(packed, result()), lane / 2);
    if (lane % 2)
      bits = ir.makeBinary(ShrUInt64, bits, ir.makeConst(int64_t(32)));
    *site = ir.makeBlock(
        {ir.makeDrop((*site)->cast<Load>()->ptr),
         ir.makeUnary(ReinterpretInt32, ir.makeUnary(WrapInt64, bits))},
        Type::f32);
  }
  statements.insert(
      statements.begin(),
      ir.makeLocalSet(packed,
                      ir.makeCall(symbol, {addresses.args[1]}, result())));
  statements.push_back(copy(back));
  return ir.makeLoop(mixed->name, ir.makeBlock(statements));
}
} // namespace ordered
