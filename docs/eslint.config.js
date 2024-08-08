import globals from 'globals'
import rootConfig from '../eslint.config.js'

export default [
  ...rootConfig,
  { ignores: ['.vitepress/dist/**/*', '.vitepress/cache/**/*'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
]
