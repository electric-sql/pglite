import rootConfig from '../../eslint.config.js'
import pluginReact from '@eslint-react/eslint-plugin'
import pluginReactCompiler from 'eslint-plugin-react-compiler'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import pluginReactRefresh from 'eslint-plugin-react-refresh'

export default [
  ...rootConfig,
  {
    files: ['**/*.{ts,tsx}'],
    ...pluginReact.configs.recommended,
  },
  {
    plugins: {
      'react-hooks': pluginReactHooks,
      'react-compiler': pluginReactCompiler,
      'react-refresh': pluginReactRefresh,
    },
    rules: {
      'react-compiler/react-compiler': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['**/test/**'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'react-compiler/react-compiler': 'off',
    },
  },
]
