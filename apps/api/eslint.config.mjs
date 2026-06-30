import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Flat config (ESLint 9) for the NestJS API. Mirrors apps/web's flat-config
 * approach but for back-end TypeScript via typescript-eslint.
 *
 * Non-type-checked `recommended` only: type safety is already enforced by
 * `tsc --noEmit` (the `typecheck` script + CI build job), so eslint here focuses
 * on lint-only correctness without the cost/noise of the type-aware ruleset.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.turbo/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Back-end pragmatics that match the codebase's existing idioms. `any` is
      // used deliberately at chain/JSON/3rd-party boundaries; constructor-based
      // DI leaves intentionally-empty bodies; explicit types aid readability.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      // Allow `_`-prefixed throwaways (unused args, destructure rest, caught errors).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
);
