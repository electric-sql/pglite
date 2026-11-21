// Test-only probe for the SQL support function used by the HNSW L2 opclass.
#include "pass.h"
#include "wasm-builder.h"
#include "wasm-io.h"
#include "wasm-validator.h"
#include <iostream>

using namespace wasm;
int main(int argc, char **argv) {
  try {
    if (argc != 3)
      throw std::runtime_error("usage: profile-operands INPUT OUTPUT");
    Module m;
    ModuleReader().read(argv[1], m);
    Builder ir(m);
    auto f = m.getFunction(m.getExport("vector_l2_squared_distance")->value);
    auto finfo = m.getExport("pg_finfo_vector_l2_squared_distance")->value;
    auto *body = f->body->dynCast<Block>();
    if (!body || body->list.size() < 3)
      throw std::runtime_error("missing pgvector argument setup");
    auto operand = [&](size_t i) {
      auto *set = body->list[i]->dynCast<LocalSet>();
      auto *call = set ? set->value->dynCast<Call>() : nullptr;
      if (!call || m.getFunction(call->target)->base != "pg_detoast_datum" ||
          call->operands.size() != 1)
        throw std::runtime_error("missing pgvector detoast call");
      auto *arg = call->operands[0]->dynCast<If>();
      auto *load = arg ? arg->ifTrue->dynCast<Load>() : nullptr;
      if (!load || load->offset.addr != 20 + 8 * (i - 1))
        throw std::runtime_error("unexpected SQL argument shape");
      return set->index;
    };
    auto left = operand(1), right = operand(2);
    auto inDomain = [&](Index index, int domain) {
      auto *tag = ir.makeBinary(ShrUInt32, ir.makeLocalGet(index, Type::i32),
                                ir.makeConst(int32_t(30)));
      return ir.makeBinary(domain ? EqInt32 : LtUInt32, tag,
                           ir.makeConst(int32_t(domain ? domain + 1 : 2)));
    };
    std::vector<Expression *> counters;
    for (int a = 0; a < 3; ++a) {
      for (int b = 0; b < 3; ++b) {
        std::string name =
            "heap_count_" + std::to_string(a) + std::to_string(b);
        m.addGlobal(
            ir.makeGlobal(name, Type::i32, ir.makeConst(0), Builder::Mutable));
        auto get = [&]() { return ir.makeGlobalGet(name, Type::i32); };
        counters.push_back(ir.makeIf(
            ir.makeBinary(AndInt32, inDomain(left, a), inDomain(right, b)),
            ir.makeGlobalSet(name,
                             ir.makeBinary(AddInt32, get(), ir.makeConst(1)))));
        m.addFunction(
            ir.makeFunction(name, Signature(Type::i32, Type::i32), {}, get()));
        m.addExport(ir.makeExport(name, name, ExternalKind::Function));
        m.addExport(
            ir.makeExport("pg_finfo_" + name, finfo, ExternalKind::Function));
      }
    }
    body->list.insertAt(3, ir.makeBlock(counters));
    if (!WasmValidator().validate(m))
      throw std::runtime_error("invalid probe");
    PassOptions options;
    ModuleWriter(options).write(m, argv[2]);
  } catch (const std::exception &e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}
