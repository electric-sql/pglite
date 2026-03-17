// '<(' is process substitution operator and
// can be parsed the same as control operator
const CONTROL =
  '(?:' +
  [
    '\\|\\|',
    '\\&\\&',
    ';;',
    '\\|\\&',
    '\\<\\(',
    '\\<\\<\\<',
    '>>',
    '>\\&',
    '<\\&',
    '[&;()|<>]',
  ].join('|') +
  ')'
const controlRE = new RegExp('^' + CONTROL + '$')
const META = '|&;()<> \\t'
const SINGLE_QUOTE = '"((\\\\"|[^"])*?)"'
const DOUBLE_QUOTE = "'((\\\\'|[^'])*?)'"
const hash = /^#$/

const SQ = "'"
const DQ = '"'
const DS = '$'

let TOKEN = ''
const mult = 0x100000000
for (let i = 0; i < 4; i++) {
  TOKEN += (mult * Math.random()).toString(16)
}
const startsWithToken = new RegExp('^' + TOKEN)

type Env = Record<string, string | undefined> | ((key: string) => unknown)

interface OpToken {
  op: string
  pattern?: string
}

interface CommentToken {
  comment: string
}

type ParsedToken = string | OpToken | CommentToken

interface ParseOpts {
  escape?: string
}

function matchAll(s: string, r: RegExp): RegExpExecArray[] {
  const origIndex = r.lastIndex

  const matches: RegExpExecArray[] = []
  let matchObj: RegExpExecArray | null

  while ((matchObj = r.exec(s))) {
    matches.push(matchObj)
    if (r.lastIndex === matchObj.index) {
      r.lastIndex += 1
    }
  }

  r.lastIndex = origIndex

  return matches
}

function getVar(env: Env, pre: string, key: string): string {
  let r: unknown = typeof env === 'function' ? env(key) : env[key]
  if (typeof r === 'undefined' && key !== '') {
    r = ''
  } else if (typeof r === 'undefined') {
    r = '$'
  }

  if (typeof r === 'object') {
    return pre + TOKEN + JSON.stringify(r) + TOKEN
  }
  return pre + (r as string)
}

function parseInternal(
  string: string,
  env?: Env,
  opts?: ParseOpts,
): ParsedToken[] {
  if (!opts) {
    opts = {}
  }
  const BS = opts.escape || '\\'
  const BAREWORD = '(\\' + BS + '[\'"' + META + ']|[^\\s\'"' + META + '])+'

  const chunker = new RegExp(
    [
      '(' + CONTROL + ')',
      '(' + BAREWORD + '|' + SINGLE_QUOTE + '|' + DOUBLE_QUOTE + ')+',
    ].join('|'),
    'g',
  )

  const matches = matchAll(string, chunker)

  if (matches.length === 0) {
    return []
  }
  if (!env) {
    env = {}
  }

  let commented = false

  return matches
    .map(function (match): ParsedToken | ParsedToken[] | undefined {
      const s = match[0]
      if (!s || commented) {
        return void undefined
      }
      if (controlRE.test(s)) {
        return { op: s }
      }

      // Hand-written scanner/parser for Bash quoting rules:
      //
      // 1. inside single quotes, all characters are printed literally.
      // 2. inside double quotes, all characters are printed literally
      //    except variables prefixed by '$' and backslashes followed by
      //    either a double quote or another backslash.
      // 3. outside of any quotes, backslashes are treated as escape
      //    characters and not printed (unless they are themselves escaped)
      // 4. quote context can switch mid-token if there is no whitespace
      //     between the two quote contexts (e.g. all'one'"token" parses as
      //     "allonetoken")
      let quote: string | false = false
      let esc = false
      let out = ''
      let isGlob = false
      let i: number

      function parseEnvVar(): string {
        i += 1
        let varend: number
        let varname: string
        const char = s.charAt(i)

        if (char === '{') {
          i += 1
          if (s.charAt(i) === '}') {
            throw new Error('Bad substitution: ' + s.slice(i - 2, i + 1))
          }
          varend = s.indexOf('}', i)
          if (varend < 0) {
            throw new Error('Bad substitution: ' + s.slice(i))
          }
          varname = s.slice(i, varend)
          i = varend
        } else if (/[*@#?$!_-]/.test(char)) {
          varname = char
          i += 1
        } else {
          const slicedFromI = s.slice(i)
          const varendMatch = slicedFromI.match(/[^\w\d_]/)
          if (!varendMatch) {
            varname = slicedFromI
            i = s.length
          } else {
            varname = slicedFromI.slice(0, varendMatch.index)
            i += varendMatch.index! - 1
          }
        }
        return getVar(env!, '', varname)
      }

      for (i = 0; i < s.length; i++) {
        let c = s.charAt(i)
        isGlob = isGlob || (!quote && (c === '*' || c === '?'))
        if (esc) {
          out += c
          esc = false
        } else if (quote) {
          if (c === quote) {
            quote = false
          } else if (quote === SQ) {
            out += c
          } else {
            if (c === BS) {
              i += 1
              c = s.charAt(i)
              if (c === DQ || c === BS || c === DS) {
                out += c
              } else {
                out += BS + c
              }
            } else if (c === DS) {
              out += parseEnvVar()
            } else {
              out += c
            }
          }
        } else if (c === DQ || c === SQ) {
          quote = c
        } else if (controlRE.test(c)) {
          return { op: s }
        } else if (hash.test(c)) {
          commented = true
          const commentObj: CommentToken = {
            comment: string.slice(match.index + i + 1),
          }
          if (out.length) {
            return [out, commentObj]
          }
          return [commentObj]
        } else if (c === BS) {
          esc = true
        } else if (c === DS) {
          out += parseEnvVar()
        } else {
          out += c
        }
      }

      if (isGlob) {
        return { op: 'glob', pattern: out }
      }

      return out
    })
    .reduce(function (prev: ParsedToken[], arg) {
      return typeof arg === 'undefined' ? prev : prev.concat(arg)
    }, [])
}

export default function parse(
  s: string,
  env?: Env,
  opts?: ParseOpts,
): ParsedToken[] {
  const mapped = parseInternal(s, env, opts)
  if (typeof env !== 'function') {
    return mapped
  }
  return mapped.reduce(function (acc: ParsedToken[], s) {
    if (typeof s === 'object') {
      return acc.concat(s)
    }
    const xs = s.split(RegExp('(' + TOKEN + '.*?' + TOKEN + ')', 'g'))
    if (xs.length === 1) {
      return acc.concat(xs[0])
    }
    return acc.concat(
      xs.filter(Boolean).map(function (x): ParsedToken {
        if (startsWithToken.test(x)) {
          return JSON.parse(x.split(TOKEN)[1]) as ParsedToken
        }
        return x
      }),
    )
  }, [])
}
