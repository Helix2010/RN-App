import { defineConfig } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';

const typescriptPlugin = expoConfig.find(
  (config) => config.plugins?.['@typescript-eslint'],
)?.plugins?.['@typescript-eslint'];

export default defineConfig([
  ...expoConfig,
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['node_modules/**', '.expo/**', 'coverage/**', 'dist/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: typescriptPlugin
      ? { '@typescript-eslint': typescriptPlugin }
      : undefined,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='fetch']:not([callee.object.name='apiClient'])",
          message: 'HTTP must go through src/core/network.',
        },
      ],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'tamagui',
              message: 'Feature code must use src/design-system instead of vendor UI APIs.',
            },
          ],
        },
      ],
    },
  },
]);
