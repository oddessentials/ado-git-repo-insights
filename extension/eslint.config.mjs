import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    security.configs.recommended,
    // Removed strict config for initial conversion - can re-enable when types are mature
    {
        // Configuration for production code (ui/)
        files: ['ui/**/*.ts'],
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
            '@typescript-eslint/no-non-null-assertion': 'error', // Prevent unsafe ! assertions (FR-005)
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
        // Configuration for test code (tests/)
        // Uses tsconfig.test.json which has relaxed strict settings appropriate for tests
        // Test code has relaxed rules because:
        // - Tests often need dynamic object manipulation (detect-object-injection)
        // - Test fixtures use readFileSync with variables (detect-non-literal-fs-filename)
        // - Test mocks may have unused variables for setup
        files: ['tests/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: 'tsconfig.test.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Relaxed rules for test files
            '@typescript-eslint/no-explicit-any': 'warn',  // Allow any in tests (with warning)
            '@typescript-eslint/no-floating-promises': 'warn',  // Relaxed for test setup
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',  // Relaxed for test fixtures
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-require-imports': 'warn',  // Tests often use require() for dynamic imports
            '@typescript-eslint/consistent-type-imports': 'warn',  // Relaxed for tests
            'prefer-const': 'warn',  // Style preference, not critical in tests
            // Security rules - relaxed for test code which often needs dynamic patterns
            'security/detect-eval-with-expression': 'error',
            'security/detect-buffer-noassert': 'error',
            'security/detect-no-csrf-before-method-override': 'error',
            'security/detect-unsafe-regex': 'error',
            'security/detect-non-literal-regexp': 'warn',  // Tests may use variable patterns
            'security/detect-non-literal-fs-filename': 'warn',  // Test fixtures use dynamic paths
            'security/detect-possible-timing-attacks': 'warn',  // Test assertions may compare
            'security/detect-object-injection': 'warn',  // Tests often manipulate objects dynamically
        },
    },
    {
        // Ignore patterns
        ignores: [
            'node_modules/**',
            'dist/**',
            'coverage/**',
            'ui/VSS.SDK.min.js',
            '**/*.js',           // Ignore remaining JS files during transition
            '**/*.cjs',          // Ignore CommonJS config files (dependency-cruiser)
            'scripts/**',        // Scripts type-checked via scripts/tsconfig.json
            'jest.config.ts',    // Ignore Jest config (handled by tsconfig)
        ],
    }
);
