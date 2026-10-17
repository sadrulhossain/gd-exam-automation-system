import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', '*.js', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Data access boundary: only repositories (and the models and DB plumbing behind them)
    // may touch Mongoose. Route handlers, services and middleware get data via repositories.
    files: ['apps/api/src/**/*.ts', 'apps/api/scripts/**/*.ts'],
    ignores: [
      'apps/api/src/models/**',
      'apps/api/src/repositories/**',
      'apps/api/src/db/**',
      'apps/api/src/tests/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['mongoose', '**/models', '**/models/*'],
              message:
                'Do not use Mongoose models directly. Add or use a repository (src/repositories) and reach it through req.repos.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  eslintConfigPrettier,
);
