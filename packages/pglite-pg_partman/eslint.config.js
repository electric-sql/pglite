import globals from 'globals'
import rootConfig from '../../eslint.config.js'

export default [
  ...rootConfig,
  {
    ignores: ['release/**/*', 'dist/**/*'],
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
]
