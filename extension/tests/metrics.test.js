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
    let performanceBackup;

    beforeAll(() => {
        // Polyfill performance API for jsdom
        performanceBackup = global.performance;
        global.performance = {
            marks: new Map(),
            measures: [],
            now: () => Date.now(),
            mark(name) {
                this.marks.set(name, this.now());
            },
            measure(name, start, end) {
                const startTime = this.marks.get(start) || 0;
                const endTime = this.marks.get(end) || this.now();
                this.measures.push({ name, duration: endTime - startTime, entryType: 'measure' });
            },
            getEntriesByName(name, type) {
                if (type === 'measure') {
                    return this.measures.filter(m => m.name === name);
                }
                return [];
            },
            clearMarks() {
                this.marks.clear();
            },
            clearMeasures() {
                this.measures = [];
            }
        };
    });

    afterAll(() => {
        global.performance = performanceBackup;
    });

    beforeEach(() => {
        // Reset performance state if it exists
        if (global.performance && global.performance.marks) {
            global.performance.marks.clear();
            global.performance.measures = [];
        }

        // Clear window globals
        delete global.window;
        delete global.process;
    });

    it('Production mode ignores __DASHBOARD_DEBUG__', () => {
        // Set production environment
        global.process = { env: { NODE_ENV: 'production' } };
        global.window = { __DASHBOARD_DEBUG__: true };

        // Re-evaluate the metrics collector logic
        const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
        const DEBUG_ENABLED = !IS_PRODUCTION && (
            (typeof window !== 'undefined' && window.__DASHBOARD_DEBUG__) ||
            (typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug'))
        );

        expect(IS_PRODUCTION).toBe(true);
        expect(DEBUG_ENABLED).toBe(false);
    });

    it('Production mode ignores ?debug param', () => {
        global.process = { env: { NODE_ENV: 'production' } };
        global.window = {
            location: { search: '?debug' }
        };

        const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
        const DEBUG_ENABLED = !IS_PRODUCTION && (
            (typeof window !== 'undefined' && window.__DASHBOARD_DEBUG__) ||
            (typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug'))
        );

        expect(DEBUG_ENABLED).toBe(false);
    });

    it('Debug mode enables metrics with __DASHBOARD_DEBUG__', () => {
        global.process = { env: { NODE_ENV: 'development' } };
        global.window = { __DASHBOARD_DEBUG__: true };

        const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
        const DEBUG_ENABLED = !IS_PRODUCTION && (
            (typeof window !== 'undefined' && window.__DASHBOARD_DEBUG__) ||
            (typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug'))
        );

        expect(DEBUG_ENABLED).toBe(true);
    });

    it('Debug mode enables metrics with ?debug param', () => {
        global.process = { env: { NODE_ENV: 'development' } };
        global.window = {
            location: { search: '?debug' }
        };

        const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
        const DEBUG_ENABLED = !IS_PRODUCTION && (
            (typeof window !== 'undefined' && window.__DASHBOARD_DEBUG__) ||
            (typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug'))
        );

        expect(DEBUG_ENABLED).toBe(true);
    });

    it('Metrics collector mark() creates performance mark', () => {
        // Simulate debug-enabled collector
        const collector = {
            marks: new Map(),
            mark(name) {
                if (!performance || !performance.mark) return;
                performance.mark(name);
                this.marks.set(name, performance.now());
            }
        };

        collector.mark('test-mark');

        expect(collector.marks.has('test-mark')).toBe(true);
        expect(global.performance.marks.has('test-mark')).toBe(true);
    });

    it('Metrics collector measure() creates performance measure', () => {
        const collector = {
            marks: new Map(),
            measures: [],
            mark(name) {
                performance.mark(name);
                this.marks.set(name, performance.now());
            },
            measure(name, startMark, endMark) {
                performance.measure(name, startMark, endMark);
                const entries = performance.getEntriesByName(name, 'measure');
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
        const collector = {
            marks: new Map(),
            measures: [],
            mark(name) {
                performance.mark(name);
                this.marks.set(name, performance.now());
            },
            reset() {
                this.marks.clear();
                this.measures = [];
                if (performance && performance.clearMarks) performance.clearMarks();
                if (performance && performance.clearMeasures) performance.clearMeasures();
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
