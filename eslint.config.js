// @ts-expect-error no types
import js from '@eslint/js'
// @ts-expect-error no types
import { FlatCompat } from '@eslint/eslintrc'
import globals from 'globals'

import eslintTsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

const compat = new FlatCompat()

export default [
  js.configs.recommended,
  ...compat.extends('plugin:@typescript-eslint/recommended'),
  {
    languageOptions: {
      parser: eslintTsParser,
      globals: {
        ...globals.browser,
      },
    },
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended?.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn', // or "error"
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-inferrable-types': 'off', // always allow explicit typings
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': ['warn', { ignoreRestArgs: true }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': 'allow-with-description' },
      ],
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['error'],
    },
  },
]
