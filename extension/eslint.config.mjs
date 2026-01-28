import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    security.configs.recommended,
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
            // === STRICT RULES - Zero tolerance for regressions ===
            '@typescript-eslint/no-explicit-any': 'error',      // No any types allowed
            '@typescript-eslint/no-floating-promises': 'error', // All promises must be handled
            '@typescript-eslint/require-await': 'off',          // Some async functions intentionally don't await

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
            '@typescript-eslint/consistent-type-imports': ['error', {
                prefer: 'type-imports',
                fixStyle: 'inline-type-imports',
            }],

            // === Security rules (eslint-plugin-security) ===
            // Errors for dangerous patterns
            'security/detect-eval-with-expression': 'error',
            'security/detect-buffer-noassert': 'error',
            'security/detect-no-csrf-before-method-override': 'error',
            'security/detect-unsafe-regex': 'error',
            'security/detect-non-literal-regexp': 'error',
            'security/detect-possible-timing-attacks': 'error',
            // Re-enabled with inline suppressions for known false positives
            // Each suppression requires -- SECURITY: <reason> tag for governance
            // See: https://github.com/eslint-community/eslint-plugin-security/issues/21
            'security/detect-object-injection': 'error',
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
