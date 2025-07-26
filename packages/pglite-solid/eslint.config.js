import rootConfig from '../../eslint.config.js'
import solid from 'eslint-plugin-solid'
import * as tsParser from '@typescript-eslint/parser'

export default [
  ...rootConfig,
  {
    files: ['**/*.{ts,tsx}'],
    ...solid,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: 'tsconfig.json',
      },
    },
  },
  {
    files: ['**/test/**'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
]
