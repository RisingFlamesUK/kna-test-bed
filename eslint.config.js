/* eslint.config.js */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vitest from 'eslint-plugin-vitest';
import importPlugin from 'eslint-plugin-import';
import configPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // Ignore generated/output
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'logs/**', '.tmp/**'] },

  // Base JS + TS (no TS type-checking for speed)
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Project-wide settings
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node, // provides process, console, Buffer, etc.
      },
    },
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': { node: true, typescript: true },
    },
    rules: {
      // add import/* rules later if you want
    },
  },

  // Tests: Vitest globals + recommended rules
  {
    files: ['test/**/*.{ts,js}'],
    plugins: { vitest },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest, // provides describe/it/expect/etc.
      },
    },
    rules: {
      ...vitest.configs.recommended.rules,
    },
  },

  // Infra & tests: don't fight strictness
  {
    files: ['suite/**/*.ts', 'test/**/*.ts', 'test/**/*.js'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Test runners: allow dynamic test titles from JSON config
  {
    files: ['test/e2e/**/_runner/*.ts'],
    rules: {
      'vitest/valid-title': 'off',
    },
  },

  // Keep Prettier last to disable conflicting stylistic rules
  configPrettier,
];
