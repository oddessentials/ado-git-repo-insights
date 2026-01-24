import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    // Removed strict config for initial conversion - can re-enable when types are mature
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['eslint.config.mjs'],
                    defaultProject: 'tsconfig.json',
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // === Relaxed rules for JS→TS conversion phase ===
            // These can be tightened as the codebase matures
            '@typescript-eslint/no-explicit-any': 'warn',      // Allow any, but warn
            '@typescript-eslint/no-floating-promises': 'warn', // Warn on floating promises
            '@typescript-eslint/require-await': 'off',         // Some async functions intentionally don't await

            // === Recommended rules ===
            // Enforce explicit return types on functions (warning only)
            '@typescript-eslint/explicit-function-return-type': 'off',
            // Allow unused vars with underscore prefix
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',  // Allow unused caught errors
            }],
            // Require explicit type annotations where inference is complex
            '@typescript-eslint/no-inferrable-types': 'off',
            // Enforce consistent type imports
            '@typescript-eslint/consistent-type-imports': ['warn', {
                prefer: 'type-imports',
                fixStyle: 'inline-type-imports',
            }],
        },
    },
    {
        // Ignore patterns - test files are type-checked via tsconfig.test.json + Jest
        // ESLint focuses on production code quality
        ignores: [
            'node_modules/**',
            'dist/**',
            'coverage/**',
            'ui/VSS.SDK.min.js',
            '**/*.js',           // Ignore remaining JS files during transition
            '**/*.cjs',          // Ignore CommonJS config files (dependency-cruiser)
            'tests/**',          // Tests type-checked via tsconfig.test.json
            'scripts/**',        // Scripts type-checked via scripts/tsconfig.json
            '**/*.test.ts',      // Test files handled by Jest + tsc
            'jest.config.ts',    // Ignore Jest config (handled by tsconfig)
        ],
    }
);
