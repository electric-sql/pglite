import globals from 'globals'
import rootConfig from '../../eslint.config.js'

export default [
  ...rootConfig,
  {
    ignores: ['dist/**/*'],
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
]
