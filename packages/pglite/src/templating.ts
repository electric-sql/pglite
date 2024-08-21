const templateTagSymbol = Symbol('templateTagSymbol')
const templateContainerSymbol = Symbol('templateContainerSymbol')

interface TemplatePart {
  [templateTagSymbol]: true
  str: string
}

interface TemplateContainer {
  [templateContainerSymbol]: true
  strings: TemplateStringsArray
  values: any[]
}

interface TemplatedQuery {
  query: string
  params: any[]
}

function addToLastAndPushWithSuffix(
  arr: string[],
  suffix: string,
  ...values: string[]
) {
  const lastArrIdx = arr.length - 1
  const lastValIdx = values.length - 1

  // no-op
  if (lastValIdx === -1) return

  // overwrite last element
  if (lastValIdx === 0) {
    arr[lastArrIdx] = arr[lastArrIdx] + values[0] + suffix
    return
  }

  // sandwich values between array and suffix
  arr[lastArrIdx] = arr[lastArrIdx] + values[0]
  arr.push(...values.slice(1, lastValIdx))
  arr.push(values[lastValIdx] + suffix)
}

/**
 * Templating utility that allows nesting multiple SQL strings without
 * losing the automatic parametrization capabilities of {@link query}.
 *
 * @example
 * ```ts
 * query`SELECT * FROM tale ${withFilter ? sql`WHERE foo = ${fooVar}` : sql``}`
 * // > { query: 'SELECT * FROM tale WHERE foo = $1', params: [fooVar] }
 * // or
 * // > { query: 'SELECT * FROM tale', params: [] }
 * ```
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: any[]
): TemplateContainer {
  const parsedStrings = [strings[0]] as string[] & {
    raw: string[]
  }
  parsedStrings.raw = [strings.raw[0]]

  const parsedValues: any[] = []
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    const nextStringIdx = i + 1

    // if value is a template tag, collapse into last string
    if (value[templateTagSymbol]) {
      addToLastAndPushWithSuffix(
        parsedStrings,
        strings[nextStringIdx],
        value.str,
      )
      addToLastAndPushWithSuffix(
        parsedStrings.raw,
        strings.raw[nextStringIdx],
        value.str,
      )
      continue
    }

    // if value is an output of this method, append in place
    if (value[templateContainerSymbol]) {
      addToLastAndPushWithSuffix(
        parsedStrings,
        strings[nextStringIdx],
        ...value.strings,
      )
      addToLastAndPushWithSuffix(
        parsedStrings.raw,
        strings.raw[nextStringIdx],
        ...value.strings.raw,
      )
      parsedValues.push(...value.values)
      continue
    }

    // otherwise keep reconstructing
    parsedStrings.push(strings[nextStringIdx])
    parsedStrings.raw.push(strings.raw[nextStringIdx])
    parsedValues.push(value)
  }

  return {
    [templateContainerSymbol]: true,
    strings: parsedStrings,
    values: parsedValues,
  }
}

/**
 * Allows adding identifiers into a query template string without
 * parametrizing them. This method will automatically escape identifiers.
 *
 * @example
 * ```ts
 * query`SELECT * FROM ${identifier`foo`} WHERE ${identifier`id`} = ${id}`
 * // > { query: 'SELECT * FROM "foo" WHERE "id" = $1', params: [id] }
 * ```
 */
export function identifier(
  strings: TemplateStringsArray,
  ...values: any[]
): TemplatePart {
  return {
    [templateTagSymbol]: true,
    str: `"${String.raw(strings, ...values)}"`,
  }
}

/**
 * Allows adding raw strings into a query template string without
 * parametrizing or modifying them in any way.
 *
 * @example
 * ```ts
 * query`SELECT * FROM foo ${raw`WHERE id = ${2+3}`}`
 * // > { query: 'SELECT * FROM foo WHERE id = 5', params: [] }
 * ```
 */

export function raw(
  strings: TemplateStringsArray,
  ...values: any[]
): TemplatePart {
  return {
    [templateTagSymbol]: true,
    str: String.raw(strings, ...values),
  }
}

/**
 * Generates a parametrized query from a templated query string, assigning
 * the provided values to the appropriate named parameters.
 *
 * You can use templating helpers like {@link identifier} and {@link raw} to
 * add identifiers and raw strings to the query without making them parameters,
 * and you can use {@link sql} to nest multiple queries and create utilities.
 *
 * @example
 * ```ts
 * query`SELECT * FROM ${identifier`foo`} WHERE id = ${id} and name = ${name}`
 * // > { query: 'SELECT * FROM "foo" WHERE id = $1 and name = $2', params: [id, name] }
 * ```
 */
export function query(
  strings: TemplateStringsArray,
  ...values: any[]
): TemplatedQuery {
  const { strings: queryStringParts, values: params } = sql(strings, ...values)
  return {
    query: [
      queryStringParts[0],
      ...params.flatMap((_, idx) => [`$${idx + 1}`, queryStringParts[idx + 1]]),
    ].join(''),
    params: params,
  }
}
