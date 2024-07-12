const indirectEval = (globalThis || window).eval;
export { indirectEval as eval };
