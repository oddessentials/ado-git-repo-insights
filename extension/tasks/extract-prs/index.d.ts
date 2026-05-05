/**
 * Type declarations for the JavaScript task runtime in this directory.
 *
 * Lets TypeScript callers (notably the packaged-runtime regression test
 * at extension/tests/extract-prs-runtime.test.ts) `import` from
 * `index.js` without `require()` and without the suppression that
 * `@typescript-eslint/no-require-imports` would otherwise demand.
 *
 * The shape mirrors module.exports in index.js exactly. Helpers are
 * declared loosely (object / unknown) since the test only needs `run`;
 * widening these later (precise BuildExtractArgsConfig etc.) is fine
 * but not part of this scope.
 */

export declare function run(): Promise<void>;

export declare function buildExtractArgs(config: object): readonly string[];
export declare function buildBackfillArgs(config: object): readonly string[];
export declare function formatProjectsForDisplay(raw: unknown): string;
export declare function isMeaningfullySet(value: unknown): boolean;
export declare function normalizeCommentsMaxPrsPerRunRaw(
  mode: string,
  includeComments: boolean,
  raw: unknown,
): string | null | undefined;
export declare function validateModeInputs(
  mode: string,
  inputs: Record<string, unknown>,
): { ok: true } | { ok: false; message: string };
export declare function validateNonNegativeInt(
  name: string,
  raw: unknown,
): number | null | undefined;
