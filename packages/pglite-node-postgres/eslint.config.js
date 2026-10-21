import globals from 'globals'
import rootConfig from '../../eslint.config.js'

export default [
  ...rootConfig,
  {
    ignores: ['release/**/*', 'examples/**/*', 'dist/**/*'],
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      ...rootConfig.rules,
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['tests/targets/deno/**/*.js'],
    languageOptions: {
      globals: {
        Deno: false,
      },
    },
  },
]
