/**
 * Dataset Loader Contract Tests (Phase 3.5)
 *
 * Tests for dataset loader behavior:
 * - Schema validation functions return typed results
 * - Load functions return typed state objects
 * - Functions never throw, return error states instead
 */

const { DatasetLoader } = require('../ui/dataset-loader');

describe('DatasetLoader', () => {
    let loader;

    beforeEach(() => {
        loader = new DatasetLoader('http://test-api');
    });

    describe('validatePredictionsSchema', () => {
        it('returns { valid: true } for valid input', () => {
            const validPredictions = {
                schema_version: 1,
                generated_at: '2026-01-14T12:00:00Z',
                forecasts: [
                    {
                        metric: 'pr_throughput',
                        unit: 'count',
                        values: [
                            { period_start: '2026-01-13', predicted: 25, lower_bound: 20, upper_bound: 30 },
                        ],
                    },
                ],
            };

            const result = loader.validatePredictionsSchema(validPredictions);
            expect(result).toEqual({ valid: true });
        });

        it('returns { valid: false, error } for missing data', () => {
            const result = loader.validatePredictionsSchema(null);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('returns { valid: false, error } for missing schema_version', () => {
            const invalidPredictions = {
                generated_at: '2026-01-14T12:00:00Z',
                forecasts: [],
            };

            const result = loader.validatePredictionsSchema(invalidPredictions);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('schema_version');
        });

        it('returns { valid: false, error } for unsupported schema version', () => {
            const futurePredictions = {
                schema_version: 99,
                generated_at: '2026-01-14T12:00:00Z',
                forecasts: [],
            };

            const result = loader.validatePredictionsSchema(futurePredictions);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('version');
        });

        it('returns { valid: false, error } for missing forecasts array', () => {
            const invalidPredictions = {
                schema_version: 1,
                generated_at: '2026-01-14T12:00:00Z',
            };

            const result = loader.validatePredictionsSchema(invalidPredictions);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('forecasts');
        });

        it('returns { valid: false, error } for invalid forecast structure', () => {
            const invalidPredictions = {
                schema_version: 1,
                generated_at: '2026-01-14T12:00:00Z',
                forecasts: [{ invalid: true }],
            };

            const result = loader.validatePredictionsSchema(invalidPredictions);
            expect(result.valid).toBe(false);
        });
    });

    describe('validateInsightsSchema', () => {
        it('returns { valid: true } for valid input', () => {
            const validInsights = {
                schema_version: 1,
                generated_at: '2026-01-14T12:00:00Z',
                insights: [
                    {
                        id: 'insight-1',
                        category: 'bottleneck',
                        severity: 'warning',
                        title: 'Test Insight',
                        description: 'Test description',
                        affected_entities: ['project:test'],
                    },
                ],
            };

            const result = loader.validateInsightsSchema(validInsights);
            expect(result).toEqual({ valid: true });
        });

        it('returns typed error object, never throws', () => {
            // Test with various invalid inputs - should never throw
            const testCases = [null, undefined, {}, { insights: 'not-array' }];

            testCases.forEach((input) => {
                expect(() => {
                    const result = loader.validateInsightsSchema(input);
                    expect(result.valid).toBe(false);
                }).not.toThrow();
            });
        });

        it('returns { valid: false, error } for missing schema_version', () => {
            const invalidInsights = {
                generated_at: '2026-01-14T12:00:00Z',
                insights: [],
            };

            const result = loader.validateInsightsSchema(invalidInsights);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('schema_version');
        });

        it('returns { valid: false, error } for missing insights array', () => {
            const invalidInsights = {
                schema_version: 1,
                generated_at: '2026-01-14T12:00:00Z',
            };

            const result = loader.validateInsightsSchema(invalidInsights);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('insights');
        });

        it('returns { valid: false, error } for invalid insight structure', () => {
            const invalidInsights = {
                schema_version: 1,
                generated_at: '2026-01-14T12:00:00Z',
                insights: [{ id: 'test' }], // Missing required fields
            };

            const result = loader.validateInsightsSchema(invalidInsights);
            expect(result.valid).toBe(false);
        });
    });

    describe('loadPredictions state machine', () => {
        const validManifest = {
            manifest_schema_version: 1,
            dataset_schema_version: 1,
            aggregates_schema_version: 1,
            features: { predictions: true },
        };

        beforeEach(async () => {
            loader.manifest = validManifest;
        });

        it('returns null when feature flag is false (disabled state)', async () => {
            loader.manifest = { ...validManifest, features: { predictions: false } };

            const result = await loader.loadPredictions();
            expect(result).toBeNull();
        });

        it('returns null on 404 (missing state)', async () => {
            fetch.mockImplementation(() => mockFetch404());

            const result = await loader.loadPredictions();
            expect(result).toBeNull();
        });

        it('returns error object on 401 (auth state)', async () => {
            fetch.mockImplementation(() => mockFetch401());

            const result = await loader.loadPredictions();
            expect(result).toHaveProperty('error');
        });

        it('returns error object on 403 (auth state)', async () => {
            fetch.mockImplementation(() => mockFetch403());

            const result = await loader.loadPredictions();
            expect(result).toHaveProperty('error');
        });

        it('returns error object on schema failure (invalid state)', async () => {
            const invalidData = { schema_version: 99, forecasts: [] };
            fetch.mockImplementation(() => mockFetchResponse(invalidData));

            const result = await loader.loadPredictions();
            expect(result).toHaveProperty('error');
            expect(result.error).toBe('PRED_001');
        });

        it('returns predictions data on success (ok state)', async () => {
            const validData = {
                schema_version: 1,
                generated_at: '2026-01-14T12:00:00Z',
                forecasts: [
                    {
                        metric: 'pr_throughput',
                        unit: 'count',
                        values: [{ period_start: '2026-01-13', predicted: 25, lower_bound: 20, upper_bound: 30 }],
                    },
                ],
            };
            fetch.mockImplementation(() => mockFetchResponse(validData));

            const result = await loader.loadPredictions();
            expect(result).toEqual(validData);
        });

        it('never returns undefined (typed states are mandatory)', async () => {
            const testCases = [
                () => mockFetch404(),
                () => mockFetch401(),
                () => mockFetchResponse({ schema_version: 99 }),
                () => mockFetchResponse({ schema_version: 1, forecasts: [] }),
            ];

            for (const mockFn of testCases) {
                fetch.mockImplementation(mockFn);
                const result = await loader.loadPredictions();
                expect(result).not.toBeUndefined();
            }
        });
    });

    describe('loadInsights state machine', () => {
        const validManifest = {
            manifest_schema_version: 1,
            dataset_schema_version: 1,
            aggregates_schema_version: 1,
            features: { ai_insights: true },
        };

        beforeEach(async () => {
            loader.manifest = validManifest;
        });

        it('returns null when feature flag is false (disabled state)', async () => {
            loader.manifest = { ...validManifest, features: { ai_insights: false } };

            const result = await loader.loadInsights();
            expect(result).toBeNull();
        });

        it('returns null on 404 (missing state)', async () => {
            fetch.mockImplementation(() => mockFetch404());

            const result = await loader.loadInsights();
            expect(result).toBeNull();
        });

        it('returns error object on 401 (auth state)', async () => {
            fetch.mockImplementation(() => mockFetch401());

            const result = await loader.loadInsights();
            expect(result).toHaveProperty('error');
        });

        it('returns error object on schema failure (invalid state)', async () => {
            const invalidData = { schema_version: 99, insights: [] };
            fetch.mockImplementation(() => mockFetchResponse(invalidData));

            const result = await loader.loadInsights();
            expect(result).toHaveProperty('error');
            expect(result.error).toBe('AI_001');
        });

        it('returns insights data on success (ok state)', async () => {
            const validData = {
                schema_version: 1,
                generated_at: '2026-01-14T12:00:00Z',
                insights: [
                    {
                        id: 'insight-1',
                        category: 'bottleneck',
                        severity: 'warning',
                        title: 'Test',
                        description: 'Test description',
                        affected_entities: [],
                    },
                ],
            };
            fetch.mockImplementation(() => mockFetchResponse(validData));

            const result = await loader.loadInsights();
            expect(result).toEqual(validData);
        });
    });

    describe('isFeatureEnabled', () => {
        it('returns false when manifest is not loaded', () => {
            loader.manifest = null;
            expect(loader.isFeatureEnabled('predictions')).toBe(false);
        });

        it('returns true when feature flag is true', () => {
            loader.manifest = { features: { predictions: true } };
            expect(loader.isFeatureEnabled('predictions')).toBe(true);
        });

        it('returns false when feature flag is false', () => {
            loader.manifest = { features: { predictions: false } };
            expect(loader.isFeatureEnabled('predictions')).toBe(false);
        });
    });
});
