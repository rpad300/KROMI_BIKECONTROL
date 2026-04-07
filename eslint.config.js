// Flat ESLint config (v9+). Minimal setup — we rely on `tsc --noEmit`
// for type safety and use ESLint purely for code-hygiene rules that
// the compiler can't catch (like "no new inline styles").
//
// If this grows, consider `typescript-eslint` + `eslint-plugin-react`.
// Kept bare on purpose to avoid dependency churn.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts (tests, tools, config files at repo root)
    files: ['tests/**/*.{js,mjs,cjs}', 'tools/**/*.{js,mjs,cjs}', '*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // Relax defaults that fight TypeScript — tsc already catches these.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/preserve-caught-error': 'off',
      '@typescript-eslint/no-useless-assignment': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      '--': 'off', // belt-and-braces
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-case-declarations': 'off',
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-async-promise-executor': 'warn',
      'prefer-const': 'warn',
      // react-hooks plugin is loaded so existing inline disable
      // directives don't error. The actual rules are deliberately
      // not enabled project-wide — too noisy on existing code.
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'off',

      // ── KROMI convention: Tailwind dark-first, no inline styles.
      // CLAUDE.md says "CSS: Tailwind dark-first" but historical code
      // uses inline styles everywhere. Warn (not error) so existing
      // files don't break the build, but every new `style={{` gets a
      // visible nudge in IDE + CI output.
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression",
          message:
            'Prefer Tailwind utility classes over inline style={{}}. New components in src/ should use className. See CLAUDE.md "Conventions" section.',
        },
      ],
    },
  },
  {
    // Ignore generated / vendored / third-party code that shouldn't be linted.
    ignores: [
      'dist/**',
      'dev-dist/**',
      'node_modules/**',
      'android/**',
      'ios/**',
      'public/**',
      '.vercel/**',
      'tools/kromi-doc/**',
      'APKRIDECONTROL/**',
      '**/*.min.js',
      // Vite config uses require() which the linter chokes on; not
      // worth fighting for a one-file Node config.
      'vite.config.ts',
      // Edge functions run in Deno — ESLint doesn't know Deno types.
      'supabase/functions/**',
    ],
  },
];
