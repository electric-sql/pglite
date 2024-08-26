/**
 * Calculates the byte length of a UTF-8 encoded string
 * Adapted from https://stackoverflow.com/a/23329386
 * @param str - UTF-8 encoded string
 * @returns byte length of string
 */
function byteLengthUtf8(str: string): number {
  let byteLength = str.length
  for (let i = str.length - 1; i >= 0; i--) {
    const code = str.charCodeAt(i)
    if (code > 0x7f && code <= 0x7ff) byteLength++
    else if (code > 0x7ff && code <= 0xffff) byteLength += 2
    if (code >= 0xdc00 && code <= 0xdfff) i-- // trail surrogate
  }
  return byteLength
}

export { byteLengthUtf8 }
