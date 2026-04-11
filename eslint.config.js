import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

const nodeFiles = ['server/**/*.ts', 'scripts/**/*.mjs']
const testFiles = ['**/*.test.{ts,tsx}']

export default defineConfig([
  {
    ignores: ['dist', 'coverage', 'node_modules'],
  },
  {
    files: nodeFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: testFiles,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
])
