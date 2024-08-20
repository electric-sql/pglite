enum TemplateTagType {
  identifier,
  raw,
}

const templateTagSymbol = Symbol('templateTagSymbol')
const templateContainerSymbol = Symbol('templateContainerSymbol')

interface TemplatePart<T = TemplateTagType> {
  [templateTagSymbol]: true
  type: T
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

export function identifier(
  strings: TemplateStringsArray,
  ...values: any[]
): TemplatePart<TemplateTagType.identifier> {
  return {
    [templateTagSymbol]: true,
    type: TemplateTagType.identifier,
    str: `"${String.raw(strings, ...values)}"`,
  }
}

export function raw(
  strings: TemplateStringsArray,
  ...values: any[]
): TemplatePart<TemplateTagType.raw> {
  return {
    [templateTagSymbol]: true,
    type: TemplateTagType.raw,
    str: String.raw(strings, ...values),
  }
}

/**
 * Generates a parametrized query from a templated query string
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
