/**
 * Generates a parametrized query from a templated query string
 */
export function parametrizeQuery(
  queryStringParts: TemplateStringsArray,
  ...params: any[]
): { query: string; params: any[] } {
  return {
    query: [
      queryStringParts[0],
      ...params.flatMap((_, idx) => [`$${idx + 1}`, queryStringParts[idx + 1]]),
    ].join(''),
    params: params,
  }
}
