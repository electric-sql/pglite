import {
  PostgreSQL,
  SQLConfig,
  keywordCompletionSource,
  schemaCompletionSource,
} from '@codemirror/lang-sql'
import { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { LanguageSupport } from '@codemirror/language'

const describeCompletions = [
  {
    label: '\\d',
    type: 'function',
    displayLabel: '\\d[S+] [ pattern ]',
    detail: 'PSQL Describe',
  },
  {
    label: '\\da',
    type: 'function',
    displayLabel: '\\da[S] [ pattern ]',
    detail: 'Lists aggregate functions',
  },
  {
    label: '\\dA',
    type: 'function',
    displayLabel: '\\dA[+] [ pattern ]',
    detail: 'Lists access methods',
  },
  {
    label: '\\dAc',
    type: 'function',
    displayLabel: '\\dAc[+] [access-method-pattern [input-type-pattern]]',
    detail: 'Lists operator classes',
  },
  {
    label: '\\dAf',
    type: 'function',
    displayLabel: '\\dAf[+] [access-method-pattern [input-type-pattern]]',
    detail: 'Lists operator families',
  },
  {
    label: '\\dAo',
    type: 'function',
    displayLabel: '\\dAo[+] [access-method-pattern [operator-family-pattern]]',
    detail: 'Lists operators associated with operator families',
  },
  {
    label: '\\dAp',
    type: 'function',
    displayLabel: '\\dAp[+] [access-method-pattern [operator-family-pattern]]',
    detail: 'Lists support functions associated with operator families',
  },
  {
    label: '\\db',
    type: 'function',
    displayLabel: '\\db[+] [ pattern ]',
    detail: 'Lists tablespaces',
  },
  {
    label: '\\dc',
    type: 'function',
    displayLabel: '\\dc[S+] [ pattern ]',
    detail: 'Lists conversions between character-set encodings',
  },
  {
    label: '\\dconfig',
    type: 'function',
    displayLabel: '\\dconfig[+] [ pattern ]',
    detail: 'Lists server configuration parameters and their values',
  },
  {
    label: '\\dC',
    type: 'function',
    displayLabel: '\\dC[+] [ pattern ]',
    detail: 'Lists type casts',
  },
  {
    label: '\\dd',
    type: 'function',
    displayLabel: '\\dd[S] [ pattern ]',
    detail:
      'Shows the descriptions of objects of type constraint, operator class, operator family, rule, and trigger',
  },
  {
    label: '\\dD',
    type: 'function',
    displayLabel: '\\dD[S+] [ pattern ]',
    detail: 'Lists domains',
  },
  {
    label: '\\ddp',
    type: 'function',
    displayLabel: '\\ddp [ pattern ]',
    detail: 'Lists default access privilege settings',
  },
  {
    label: '\\dE',
    type: 'function',
    displayLabel: '\\dE[S+] [ pattern ]',
    detail: 'Lists foreign tables',
  },
  {
    label: '\\di',
    type: 'function',
    displayLabel: '\\di[S+] [ pattern ]',
    detail: 'Lists indexes',
  },
  {
    label: '\\dm',
    type: 'function',
    displayLabel: '\\dm[S+] [ pattern ]',
    detail: 'Lists materialized views',
  },
  {
    label: '\\ds',
    type: 'function',
    displayLabel: '\\ds[S+] [ pattern ]',
    detail: 'Lists sequences',
  },
  {
    label: '\\dt',
    type: 'function',
    displayLabel: '\\dt[S+] [ pattern ]',
    detail: 'Lists tables',
  },
  {
    label: '\\dv',
    type: 'function',
    displayLabel: '\\dv[S+] [ pattern ]',
    detail: 'Lists views',
  },
  {
    label: '\\des',
    type: 'function',
    displayLabel: '\\des[+] [ pattern ]',
    detail: 'Lists foreign servers',
  },
  {
    label: '\\det',
    type: 'function',
    displayLabel: '\\det[+] [ pattern ]',
    detail: 'Lists foreign tables',
  },
  {
    label: '\\deu',
    type: 'function',
    displayLabel: '\\deu[+] [ pattern ]',
    detail: 'Lists user mappings',
  },
  {
    label: '\\dew',
    type: 'function',
    displayLabel: '\\dew[+] [ pattern ]',
    detail: 'Lists foreign-data wrappers',
  },
  {
    label: '\\df',
    type: 'function',
    displayLabel: '\\df[anptwS+] [ pattern [ arg_pattern ... ] ]',
    detail: 'Lists functions',
  },
  {
    label: '\\dF',
    type: 'function',
    displayLabel: '\\dF[+] [ pattern ]',
    detail: 'Lists text search configurations',
  },
  {
    label: '\\dFd',
    type: 'function',
    displayLabel: '\\dFd[+] [ pattern ]',
    detail: 'Lists text search dictionaries',
  },
  {
    label: '\\dFp',
    type: 'function',
    displayLabel: '\\dFp[+] [ pattern ]',
    detail: 'Lists text search parsers',
  },
  {
    label: '\\dFt',
    type: 'function',
    displayLabel: '\\dFt[+] [ pattern ]',
    detail: 'Lists text search templates',
  },
  {
    label: '\\dg',
    type: 'function',
    displayLabel: '\\dg[S+] [ pattern ]',
    detail: 'Lists database roles',
  },
  {
    label: '\\dl',
    type: 'function',
    displayLabel: '\\dl[+] ',
    detail: 'List large objects',
  },
  {
    label: '\\dL',
    type: 'function',
    displayLabel: '\\dL[S+] [ pattern ]',
    detail: 'Lists procedural languages',
  },
  {
    label: '\\dn',
    type: 'function',
    displayLabel: '\\dn[S+] [ pattern ]',
    detail: 'Lists schemas',
  },
  {
    label: '\\do',
    type: 'function',
    displayLabel: '\\do[S+] [ pattern [ arg_pattern [ arg_pattern ] ] ]',
    detail: 'Lists operators with their operand and result types',
  },
  {
    label: '\\dO',
    type: 'function',
    displayLabel: '\\dO[S+] [ pattern ]',
    detail: 'Lists collations',
  },
  {
    label: '\\dp',
    type: 'function',
    displayLabel: '\\dp[S] [ pattern ]',
    detail:
      'Lists tables, views and sequences with their associated access privileges',
  },
  {
    label: '\\dP',
    type: 'function',
    displayLabel: '\\dP[itn+] [ pattern ]',
    detail: 'Lists partitioned relations',
  },
  {
    label: '\\drds',
    type: 'function',
    displayLabel: '\\drds [ role-pattern [ database-pattern ] ]',
    detail: 'Lists defined configuration settings',
  },
  {
    label: '\\drg',
    type: 'function',
    displayLabel: '\\drg[S] [ pattern ]',
    detail: 'Lists information about each granted role membership',
  },
  {
    label: '\\dRp',
    type: 'function',
    displayLabel: '\\dRp[+] [ pattern ]',
    detail: 'Lists replication publications',
  },
  {
    label: '\\dRs',
    type: 'function',
    displayLabel: '\\dRs[+] [ pattern ]',
    detail: 'Lists replication subscriptions',
  },
  {
    label: '\\dT',
    type: 'function',
    displayLabel: '\\dT[S+] [ pattern ]',
    detail: 'Lists data types',
  },
  {
    label: '\\du',
    type: 'function',
    displayLabel: '\\du[S+] [ pattern ]',
    detail: 'Lists database roles',
  },
  {
    label: '\\dx',
    type: 'function',
    displayLabel: '\\dx[+] [ pattern ]',
    detail: 'Lists installed extensions',
  },
  {
    label: '\\dX',
    type: 'function',
    displayLabel: '\\dX [ pattern ]',
    detail: 'Lists extended statistics',
  },
  {
    label: '\\dy',
    type: 'function',
    displayLabel: '\\dy[+] [ pattern ]',
    detail: 'Lists event triggers',
  },
]

function describeCompletionsAutoComplete(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/\\\w*/)
  if (!word || word.from === word.to) return null
  return {
    from: word.from,
    options: describeCompletions,
  }
}

// This is a reimplemented version of `sql()` from `@codemirror/lang-sql` that
// includes a custom autocompletion function for postgresql's `\d` command.
export function makeSqlExt(config: SQLConfig = {}) {
  const lang = config.dialect || PostgreSQL
  return new LanguageSupport(lang.language, [
    // schemaCompletion(config),
    config.schema
      ? lang.language.data.of({
          autocomplete: schemaCompletionSource(config),
        })
      : [],
    // keywordCompletion(lang, !!config.upperCaseKeywords)
    lang.language.data.of({
      autocomplete: keywordCompletionSource(lang, !!config.upperCaseKeywords),
    }),
    lang.language.data.of({
      autocomplete: describeCompletionsAutoComplete,
    }),
  ])
}
