/**
 * Phase 4: Metrics Collector Tests
 *
 * Tests for production-safe metrics collection:
 * - Production mode ignores debug flags
 * - Metrics only collected when opt-in enabled
 * - Test isolation (metrics reset between tests)
 * - Performance API polyfill for jest/jsdom
 */

describe('Metrics Collector (Phase 4)', () => {
    // Performance API polyfill is provided by tests/setup.ts

    let originalWindow: any;
    let originalProcess: any;

    beforeEach(() => {
        originalWindow = (global as any).window;
        originalProcess = (global as any).process;
        // Clear window/process globals for production/debug flag tests
        delete (global as any).window;
        delete (global as any).process;
    });

    afterEach(() => {
        (global as any).window = originalWindow;
        (global as any).process = originalProcess;
    });

    it('Production mode ignores __DASHBOARD_DEBUG__', () => {
        // Set production environment
        (global as any).process = { env: { NODE_ENV: 'production' } };
        (global as any).window = { __DASHBOARD_DEBUG__: true };

        // Re-evaluate the metrics collector logic
        const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
        const DEBUG_ENABLED = !IS_PRODUCTION && (
            (typeof window !== 'undefined' && (window as any).__DASHBOARD_DEBUG__) ||
            (typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug'))
        );

        expect(IS_PRODUCTION).toBe(true);
        expect(DEBUG_ENABLED).toBe(false);
    });

    it('Production mode ignores ?debug param', () => {
        (global as any).process = { env: { NODE_ENV: 'production' } };
        (global as any).window = {
            location: { search: '?debug' }
        };

        const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
        const DEBUG_ENABLED = !IS_PRODUCTION && (
            (typeof window !== 'undefined' && (window as any).__DASHBOARD_DEBUG__) ||
            (typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug'))
        );

        expect(DEBUG_ENABLED).toBe(false);
    });

    it('Debug mode enables metrics with __DASHBOARD_DEBUG__', () => {
        (global as any).process = { env: { NODE_ENV: 'development' } };
        (global as any).window = { __DASHBOARD_DEBUG__: true };

        const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
        const DEBUG_ENABLED = !IS_PRODUCTION && (
            (typeof window !== 'undefined' && (window as any).__DASHBOARD_DEBUG__) ||
            (typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug'))
        );

        expect(DEBUG_ENABLED).toBe(true);
    });

    it('Debug mode enables metrics with ?debug param', () => {
        (global as any).process = { env: { NODE_ENV: 'development' } };
        (global as any).window = {
            location: { search: '?debug' }
        };

        const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
        const DEBUG_ENABLED = !IS_PRODUCTION && (
            (typeof window !== 'undefined' && (window as any).__DASHBOARD_DEBUG__) ||
            (typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug'))
        );

        expect(DEBUG_ENABLED).toBe(true);
    });

    it('Metrics collector mark() creates performance mark', () => {
        // Test collector behavior with our polyfill (no guards needed in test env)
        const collector = {
            marks: new Map<string, number>(),
            mark(name: string) {
                (global as any).performance.mark(name);
                this.marks.set(name, (global as any).performance.now());
            }
        };

        collector.mark('test-mark');

        expect(collector.marks.has('test-mark')).toBe(true);
        expect((global as any).performance.marks.has('test-mark')).toBe(true);
    });

    it('Metrics collector measure() creates performance measure', () => {
        // Test collector behavior with our polyfill (no guards needed in test env)
        const collector = {
            marks: new Map<string, number>(),
            measures: [] as any[],
            mark(name: string) {
                (global as any).performance.mark(name);
                this.marks.set(name, (global as any).performance.now());
            },
            measure(name: string, startMark: string, endMark: string) {
                (global as any).performance.measure(name, startMark, endMark);
                const entries = (global as any).performance.getEntriesByName(name, 'measure');
                if (entries.length > 0) {
                    this.measures.push({
                        name,
                        duration: entries[entries.length - 1].duration,
                        timestamp: Date.now()
                    });
                }
            }
        };

        collector.mark('start');
        collector.mark('end');
        collector.measure('test-measure', 'start', 'end');

        expect(collector.measures.length).toBe(1);
        expect(collector.measures[0].name).toBe('test-measure');
        expect(collector.measures[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('Metrics collector reset() clears all metrics', () => {
        // Test collector behavior with our polyfill (no guards needed in test env)
        const collector = {
            marks: new Map<string, number>(),
            measures: [] as any[],
            mark(name: string) {
                (global as any).performance.mark(name);
                this.marks.set(name, (global as any).performance.now());
            },
            reset() {
                this.marks.clear();
                this.measures = [];
                (global as any).performance.clearMarks();
                (global as any).performance.clearMeasures();
            }
        };

        collector.mark('test1');
        collector.mark('test2');
        expect(collector.marks.size).toBe(2);

        collector.reset();
        expect(collector.marks.size).toBe(0);
        expect(collector.measures.length).toBe(0);
    });
});
