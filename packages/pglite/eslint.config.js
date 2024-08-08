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
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  {
    files: ['src/contrib/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
]
