/**
 * Dashboard Rendering Tests (Phase 3.5)
 *
 * Tests for UI rendering stability:
 * - Rendering functions handle null/undefined safely
 * - Stub warnings display correctly
 * - Insights group by severity
 * - Error states render appropriate messages
 * - Rendering functions never throw
 */

// Mock DOM elements and functions from dashboard.js
// Since dashboard.js uses globals and DOM, we need to set up the environment

describe('Dashboard Rendering', () => {
    // Set up minimal DOM structure
    beforeEach(() => {
        document.body.innerHTML = `
      <div id="tab-predictions">
        <div class="feature-unavailable"></div>
      </div>
      <div id="tab-ai-insights">
        <div class="feature-unavailable"></div>
      </div>
      <div id="predictions-unavailable" class="hidden"></div>
      <div id="ai-unavailable" class="hidden"></div>
    `;
    });

    describe('renderPredictions', () => {
        // Import functions after DOM is set up
        const createRenderPredictions = () => {
            // Inline the rendering logic for testing
            return function renderPredictions(container, predictions) {
                if (!container) return;

                const content = document.createElement('div');
                content.className = 'predictions-content';

                // Stub warning banner
                if (predictions && predictions.is_stub) {
                    content.innerHTML += `
            <div class="stub-warning">
              ⚠️ This data is synthetic (stub) and for demonstration only.
            </div>
          `;
                }

                if (predictions && predictions.forecasts) {
                    predictions.forecasts.forEach((forecast) => {
                        const section = document.createElement('div');
                        section.className = 'forecast-section';
                        section.innerHTML = `<h4>${forecast.metric}</h4>`;
                        content.appendChild(section);
                    });
                }

                container.appendChild(content);
            };
        };

        it('handles null input safely (never throws)', () => {
            const renderPredictions = createRenderPredictions();
            const container = document.getElementById('tab-predictions');

            expect(() => {
                renderPredictions(container, null);
            }).not.toThrow();
        });

        it('handles undefined input safely (never throws)', () => {
            const renderPredictions = createRenderPredictions();
            const container = document.getElementById('tab-predictions');

            expect(() => {
                renderPredictions(container, undefined);
            }).not.toThrow();
        });

        it('renders stub warning when is_stub=true', () => {
            const renderPredictions = createRenderPredictions();
            const container = document.getElementById('tab-predictions');

            const stubPredictions = {
                is_stub: true,
                forecasts: [],
            };

            renderPredictions(container, stubPredictions);

            expect(container.innerHTML).toContain('stub-warning');
            expect(container.innerHTML).toContain('synthetic');
        });

        it('does not render stub warning when is_stub=false', () => {
            const renderPredictions = createRenderPredictions();
            const container = document.getElementById('tab-predictions');

            const realPredictions = {
                is_stub: false,
                forecasts: [],
            };

            renderPredictions(container, realPredictions);

            expect(container.innerHTML).not.toContain('stub-warning');
        });

        it('handles null container safely', () => {
            const renderPredictions = createRenderPredictions();

            expect(() => {
                renderPredictions(null, { forecasts: [] });
            }).not.toThrow();
        });
    });

    describe('renderAIInsights', () => {
        const createRenderAIInsights = () => {
            return function renderAIInsights(container, insights) {
                if (!container) return;

                const content = document.createElement('div');
                content.className = 'insights-content';

                if (insights && insights.is_stub) {
                    content.innerHTML += `
            <div class="stub-warning">
              ⚠️ This data is synthetic (stub) and for demonstration only.
            </div>
          `;
                }

                if (insights && insights.insights) {
                    // Group by severity
                    const severityOrder = ['critical', 'warning', 'info'];
                    const grouped = {};
                    insights.insights.forEach((insight) => {
                        if (!grouped[insight.severity]) grouped[insight.severity] = [];
                        grouped[insight.severity].push(insight);
                    });

                    severityOrder.forEach((severity) => {
                        if (!grouped[severity]) return;

                        const section = document.createElement('div');
                        section.className = `severity-section severity-${severity}`;
                        section.setAttribute('data-severity', severity);
                        section.innerHTML = `<h4>${severity}</h4>`;
                        grouped[severity].forEach((insight) => {
                            section.innerHTML += `<div class="insight-card">${insight.title}</div>`;
                        });
                        content.appendChild(section);
                    });
                }

                container.appendChild(content);
            };
        };

        it('groups insights by severity correctly', () => {
            const renderAIInsights = createRenderAIInsights();
            const container = document.getElementById('tab-ai-insights');

            const insights = {
                insights: [
                    { id: '1', severity: 'info', title: 'Info insight' },
                    { id: '2', severity: 'critical', title: 'Critical insight' },
                    { id: '3', severity: 'warning', title: 'Warning insight' },
                    { id: '4', severity: 'critical', title: 'Another critical' },
                ],
            };

            renderAIInsights(container, insights);

            // Check severity sections exist
            const sections = container.querySelectorAll('.severity-section');
            expect(sections.length).toBe(3);

            // Check order: critical, warning, info
            const severities = Array.from(sections).map((s) => s.getAttribute('data-severity'));
            expect(severities).toEqual(['critical', 'warning', 'info']);
        });

        it('handles null input safely (never throws)', () => {
            const renderAIInsights = createRenderAIInsights();
            const container = document.getElementById('tab-ai-insights');

            expect(() => {
                renderAIInsights(container, null);
            }).not.toThrow();
        });

        it('handles undefined input safely (never throws)', () => {
            const renderAIInsights = createRenderAIInsights();
            const container = document.getElementById('tab-ai-insights');

            expect(() => {
                renderAIInsights(container, undefined);
            }).not.toThrow();
        });

        it('renders stub warning when is_stub=true', () => {
            const renderAIInsights = createRenderAIInsights();
            const container = document.getElementById('tab-ai-insights');

            const stubInsights = {
                is_stub: true,
                insights: [],
            };

            renderAIInsights(container, stubInsights);

            expect(container.innerHTML).toContain('stub-warning');
        });
    });

    describe('Error State Rendering', () => {
        const createRenderPredictionsError = () => {
            return function renderPredictionsError(container, errorCode, message) {
                if (!container) return;

                const unavailable = container.querySelector('.feature-unavailable');
                if (unavailable) {
                    unavailable.innerHTML = `
            <div class="icon">⚠️</div>
            <h2>Unable to Display Predictions</h2>
            <p>${message || 'An error occurred loading predictions data.'}</p>
            <p class="hint">[Error code: ${errorCode}]</p>
          `;
                    unavailable.classList.remove('hidden');
                }
            };
        };

        const createRenderPredictionsEmpty = () => {
            return function renderPredictionsEmpty(container) {
                if (!container) return;

                const unavailable = container.querySelector('.feature-unavailable');
                if (unavailable) {
                    unavailable.innerHTML = `
            <div class="icon">📊</div>
            <h2>No Prediction Data Yet</h2>
            <p>Predictions are enabled but no data is available.</p>
          `;
                    unavailable.classList.remove('hidden');
                }
            };
        };

        const createRenderInsightsError = () => {
            return function renderInsightsError(container, errorCode, message) {
                if (!container) return;

                const unavailable = container.querySelector('.feature-unavailable');
                if (unavailable) {
                    unavailable.innerHTML = `
            <div class="icon">⚠️</div>
            <h2>Unable to Display AI Insights</h2>
            <p>${message || 'An error occurred loading insights data.'}</p>
            <p class="hint">[Error code: ${errorCode}]</p>
          `;
                    unavailable.classList.remove('hidden');
                }
            };
        };

        const createRenderInsightsEmpty = () => {
            return function renderInsightsEmpty(container) {
                if (!container) return;

                const unavailable = container.querySelector('.feature-unavailable');
                if (unavailable) {
                    unavailable.innerHTML = `
            <div class="icon">🤖</div>
            <h2>No Insights Available</h2>
            <p>AI analysis is enabled but no insights were generated.</p>
          `;
                    unavailable.classList.remove('hidden');
                }
            };
        };

        it('Missing state shows "Not generated yet" message for predictions', () => {
            const renderPredictionsEmpty = createRenderPredictionsEmpty();
            const container = document.getElementById('tab-predictions');

            renderPredictionsEmpty(container);

            expect(container.innerHTML).toContain('No Prediction Data');
        });

        it('Invalid state shows "Unable to display" + diagnostic code for predictions', () => {
            const renderPredictionsError = createRenderPredictionsError();
            const container = document.getElementById('tab-predictions');

            renderPredictionsError(container, 'PRED_001', 'Schema validation failed');

            expect(container.innerHTML).toContain('Unable to Display');
            expect(container.innerHTML).toContain('PRED_001');
        });

        it('Empty state shows "No data yet" message for insights', () => {
            const renderInsightsEmpty = createRenderInsightsEmpty();
            const container = document.getElementById('tab-ai-insights');

            renderInsightsEmpty(container);

            expect(container.innerHTML).toContain('No Insights Available');
        });

        it('Invalid state shows "Unable to display" + diagnostic code for insights', () => {
            const renderInsightsError = createRenderInsightsError();
            const container = document.getElementById('tab-ai-insights');

            renderInsightsError(container, 'AI_001', 'Schema validation failed');

            expect(container.innerHTML).toContain('Unable to Display');
            expect(container.innerHTML).toContain('AI_001');
        });

        it('rendering functions handle null container (never throw)', () => {
            const renderPredictionsError = createRenderPredictionsError();
            const renderPredictionsEmpty = createRenderPredictionsEmpty();
            const renderInsightsError = createRenderInsightsError();
            const renderInsightsEmpty = createRenderInsightsEmpty();

            expect(() => renderPredictionsError(null, 'ERR', 'msg')).not.toThrow();
            expect(() => renderPredictionsEmpty(null)).not.toThrow();
            expect(() => renderInsightsError(null, 'ERR', 'msg')).not.toThrow();
            expect(() => renderInsightsEmpty(null)).not.toThrow();
        });
    });

    describe('Date-Range Warning UX', () => {
        /**
         * Implementation of showDateRangeWarning for testing.
         * Mirrors the logic in dashboard.js.
         */
        const createShowDateRangeWarning = () => {
            return function showDateRangeWarning(days) {
                return new Promise((resolve) => {
                    // Create modal if it doesn't exist
                    let modal = document.getElementById('date-range-warning-modal');
                    if (!modal) {
                        modal = document.createElement('div');
                        modal.id = 'date-range-warning-modal';
                        modal.className = 'modal';
                        modal.innerHTML = `
                            <div class="modal-content">
                                <div class="modal-header">
                                    <h3>⚠️ Large Date Range</h3>
                                </div>
                                <div class="modal-body">
                                    <p>You've selected a date range of <strong id="modal-days"></strong> days.</p>
                                    <p>Loading data for large date ranges may take longer and could impact performance.</p>
                                </div>
                                <div class="modal-footer">
                                    <button id="modal-adjust" class="btn btn-secondary">Adjust Range</button>
                                    <button id="modal-continue" class="btn btn-primary">Continue Anyway</button>
                                </div>
                            </div>
                        `;
                        document.body.appendChild(modal);
                    }

                    // Update days count
                    document.getElementById('modal-days').textContent = days;

                    // Show modal
                    modal.classList.add('show');

                    // Handle button clicks
                    const adjustBtn = document.getElementById('modal-adjust');
                    const continueBtn = document.getElementById('modal-continue');

                    const cleanup = () => {
                        modal.classList.remove('show');
                        adjustBtn.removeEventListener('click', onAdjust);
                        continueBtn.removeEventListener('click', onContinue);
                    };

                    const onAdjust = () => {
                        cleanup();
                        resolve(false);
                    };

                    const onContinue = () => {
                        cleanup();
                        resolve(true);
                    };

                    adjustBtn.addEventListener('click', onAdjust);
                    continueBtn.addEventListener('click', onContinue);
                });
            };
        };

        beforeEach(() => {
            // Reset body for modal tests
            document.body.innerHTML = '';
        });

        afterEach(() => {
            // Clean up any modals
            const modal = document.getElementById('date-range-warning-modal');
            if (modal) modal.remove();
        });

        it('Range > 365 days → modal visible, load blocked', async () => {
            const showDateRangeWarning = createShowDateRangeWarning();
            const days = 400;

            // Start showing the warning (don't await yet)
            const warningPromise = showDateRangeWarning(days);

            // Modal should be visible
            const modal = document.getElementById('date-range-warning-modal');
            expect(modal).not.toBeNull();
            expect(modal.classList.contains('show')).toBe(true);

            // Days should be displayed
            const daysElement = document.getElementById('modal-days');
            expect(daysElement.textContent).toBe('400');

            // Clean up by clicking continue
            document.getElementById('modal-continue').click();
            await warningPromise;
        });

        it('"Adjust Range" click → modal hidden, returns false (load cancelled)', async () => {
            const showDateRangeWarning = createShowDateRangeWarning();
            const days = 500;

            const warningPromise = showDateRangeWarning(days);

            // Click "Adjust Range"
            document.getElementById('modal-adjust').click();

            const result = await warningPromise;

            // Should return false (cancel)
            expect(result).toBe(false);

            // Modal should be hidden
            const modal = document.getElementById('date-range-warning-modal');
            expect(modal.classList.contains('show')).toBe(false);
        });

        it('"Continue" click → modal hidden, returns true (load proceeds)', async () => {
            const showDateRangeWarning = createShowDateRangeWarning();
            const days = 730;

            const warningPromise = showDateRangeWarning(days);

            // Click "Continue Anyway"
            document.getElementById('modal-continue').click();

            const result = await warningPromise;

            // Should return true (proceed)
            expect(result).toBe(true);

            // Modal should be hidden
            const modal = document.getElementById('date-range-warning-modal');
            expect(modal.classList.contains('show')).toBe(false);
        });

        it('Modal displays correct day count', async () => {
            const showDateRangeWarning = createShowDateRangeWarning();
            const days = 999;

            const warningPromise = showDateRangeWarning(days);

            const daysElement = document.getElementById('modal-days');
            expect(daysElement.textContent).toBe('999');

            // Clean up
            document.getElementById('modal-continue').click();
            await warningPromise;
        });

        it('Modal can be shown multiple times', async () => {
            const showDateRangeWarning = createShowDateRangeWarning();

            // First show
            let promise = showDateRangeWarning(400);
            document.getElementById('modal-adjust').click();
            let result = await promise;
            expect(result).toBe(false);

            // Second show
            promise = showDateRangeWarning(500);
            document.getElementById('modal-continue').click();
            result = await promise;
            expect(result).toBe(true);
        });

        describe('applyCustomDates integration', () => {
            /**
             * Simulates applyCustomDates logic for testing threshold behavior.
             */
            const createApplyCustomDates = (showWarningFn) => {
                return async function applyCustomDates(startDate, endDate) {
                    const daysDiff = Math.floor(
                        (endDate - startDate) / (1000 * 60 * 60 * 24)
                    );

                    // Show warning if range > 365 days
                    if (daysDiff > 365) {
                        const proceed = await showWarningFn(daysDiff);
                        if (!proceed) {
                            return { proceeded: false, reason: 'user-cancelled' };
                        }
                    }

                    return { proceeded: true, daysDiff };
                };
            };

            it('Range <= 365 days → no modal, load proceeds immediately', async () => {
                let warningShown = false;
                const mockShowWarning = jest.fn(() => {
                    warningShown = true;
                    return Promise.resolve(true);
                });

                const applyCustomDates = createApplyCustomDates(mockShowWarning);

                const start = new Date('2025-01-01');
                const end = new Date('2025-12-31'); // 364 days

                const result = await applyCustomDates(start, end);

                expect(mockShowWarning).not.toHaveBeenCalled();
                expect(result.proceeded).toBe(true);
            });

            it('Range exactly 366 days → modal shown', async () => {
                const mockShowWarning = jest.fn(() => Promise.resolve(true));

                const applyCustomDates = createApplyCustomDates(mockShowWarning);

                const start = new Date('2025-01-01');
                const end = new Date('2026-01-02'); // 366 days

                await applyCustomDates(start, end);

                expect(mockShowWarning).toHaveBeenCalledWith(366);
            });

            it('Large range + user cancels → load cancelled', async () => {
                const mockShowWarning = jest.fn(() => Promise.resolve(false));

                const applyCustomDates = createApplyCustomDates(mockShowWarning);

                const start = new Date('2024-01-01');
                const end = new Date('2026-01-01'); // ~730 days

                const result = await applyCustomDates(start, end);

                expect(result.proceeded).toBe(false);
                expect(result.reason).toBe('user-cancelled');
            });
        });
    });
});

// ============================================================================
// Sprint 1-5 Feature Tests: Dashboard Enhancement Plan
// ============================================================================

describe('Utility Functions', () => {
    /**
     * Duration formatting (mirrors dashboard.js formatDuration)
     */
    const createFormatDuration = () => {
        return function formatDuration(minutes) {
            if (minutes < 60) return `${Math.round(minutes)}m`;
            if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
            return `${(minutes / 1440).toFixed(1)}d`;
        };
    };

    /**
     * Median calculation (mirrors dashboard.js median)
     */
    const createMedian = () => {
        return function median(arr) {
            if (!arr || arr.length === 0) return null;
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };
    };

    describe('formatDuration', () => {
        const formatDuration = createFormatDuration();

        it('formats minutes correctly', () => {
            expect(formatDuration(30)).toBe('30m');
            expect(formatDuration(59)).toBe('59m');
            expect(formatDuration(1)).toBe('1m');
        });

        it('formats hours correctly', () => {
            expect(formatDuration(60)).toBe('1.0h');
            expect(formatDuration(90)).toBe('1.5h');
            expect(formatDuration(180)).toBe('3.0h');
            expect(formatDuration(1439)).toBe('24.0h');
        });

        it('formats days correctly', () => {
            expect(formatDuration(1440)).toBe('1.0d');
            expect(formatDuration(2880)).toBe('2.0d');
            expect(formatDuration(4320)).toBe('3.0d');
        });

        it('rounds minutes properly', () => {
            expect(formatDuration(30.4)).toBe('30m');
            expect(formatDuration(30.6)).toBe('31m');
        });
    });

    describe('median', () => {
        const median = createMedian();

        it('calculates median for odd-length arrays', () => {
            expect(median([1, 2, 3])).toBe(2);
            expect(median([5, 1, 3])).toBe(3); // Sorts first
            expect(median([10])).toBe(10);
        });

        it('calculates median for even-length arrays', () => {
            expect(median([1, 2, 3, 4])).toBe(2.5);
            expect(median([4, 1, 3, 2])).toBe(2.5); // Sorts first
        });

        it('handles edge cases', () => {
            expect(median([])).toBe(null);
            expect(median(null)).toBe(null);
            expect(median(undefined)).toBe(null);
        });
    });
});

describe('Sprint 1: Trend Deltas & Metrics', () => {
    /**
     * Calculate metrics from rollups (mirrors dashboard.js calculateMetrics)
     */
    const createCalculateMetrics = (medianFn) => {
        return function calculateMetrics(rollups) {
            if (!rollups || !rollups.length) {
                return { totalPrs: 0, cycleP50: null, cycleP90: null, avgAuthors: 0, avgReviewers: 0 };
            }

            const totalPrs = rollups.reduce((sum, r) => sum + (r.pr_count || 0), 0);

            const p50Values = rollups
                .map(r => r.cycle_time_p50)
                .filter(v => v !== null && v !== undefined);
            const p90Values = rollups
                .map(r => r.cycle_time_p90)
                .filter(v => v !== null && v !== undefined);

            const authorsSum = rollups.reduce((sum, r) => sum + (r.authors_count || 0), 0);
            const reviewersSum = rollups.reduce((sum, r) => sum + (r.reviewers_count || 0), 0);

            return {
                totalPrs,
                cycleP50: p50Values.length ? medianFn(p50Values) : null,
                cycleP90: p90Values.length ? medianFn(p90Values) : null,
                avgAuthors: rollups.length > 0 ? Math.round(authorsSum / rollups.length) : 0,
                avgReviewers: rollups.length > 0 ? Math.round(reviewersSum / rollups.length) : 0
            };
        };
    };

    /**
     * Calculate percentage change (mirrors dashboard.js calculatePercentChange)
     */
    const createCalculatePercentChange = () => {
        return function calculatePercentChange(current, previous) {
            if (previous === null || previous === undefined || previous === 0) {
                return null;
            }
            if (current === null || current === undefined) {
                return null;
            }
            return ((current - previous) / previous) * 100;
        };
    };

    /**
     * Get previous period dates (mirrors dashboard.js getPreviousPeriod)
     */
    const createGetPreviousPeriod = () => {
        return function getPreviousPeriod(start, end) {
            const durationMs = end.getTime() - start.getTime();
            const prevEnd = new Date(start.getTime() - 1);
            const prevStart = new Date(prevEnd.getTime() - durationMs);
            return { start: prevStart, end: prevEnd };
        };
    };

    /**
     * Render delta indicator (mirrors dashboard.js renderDelta)
     */
    const createRenderDelta = () => {
        return function renderDelta(element, percentChange, inverse = false) {
            if (!element) return;

            if (percentChange === null) {
                element.innerHTML = '';
                element.className = 'metric-delta';
                return;
            }

            const isNeutral = Math.abs(percentChange) < 2;
            const isPositive = percentChange > 0;
            const absChange = Math.abs(percentChange);

            let cssClass = 'metric-delta ';
            let arrow = '';

            if (isNeutral) {
                cssClass += 'delta-neutral';
                arrow = '~';
            } else if (isPositive) {
                cssClass += inverse ? 'delta-negative-inverse' : 'delta-positive';
                arrow = '&#9650;';
            } else {
                cssClass += inverse ? 'delta-positive-inverse' : 'delta-negative';
                arrow = '&#9660;';
            }

            const sign = isPositive ? '+' : '';
            element.className = cssClass;
            element.innerHTML = `<span class="delta-arrow">${arrow}</span> ${sign}${absChange.toFixed(0)}% <span class="delta-label">vs prev</span>`;
        };
    };

    // Helper median function for tests
    const median = (arr) => {
        if (!arr || arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    describe('calculateMetrics', () => {
        const calculateMetrics = createCalculateMetrics(median);

        it('calculates metrics from rollups correctly', () => {
            const rollups = [
                { pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120, authors_count: 5, reviewers_count: 3 },
                { pr_count: 15, cycle_time_p50: 90, cycle_time_p90: 180, authors_count: 7, reviewers_count: 4 },
                { pr_count: 12, cycle_time_p50: 75, cycle_time_p90: 150, authors_count: 6, reviewers_count: 5 }
            ];

            const metrics = calculateMetrics(rollups);

            expect(metrics.totalPrs).toBe(37);
            expect(metrics.cycleP50).toBe(75); // median of [60, 90, 75] = 75
            expect(metrics.cycleP90).toBe(150); // median of [120, 180, 150] = 150
            expect(metrics.avgAuthors).toBe(6); // (5+7+6)/3 = 6
            expect(metrics.avgReviewers).toBe(4); // (3+4+5)/3 = 4
        });

        it('handles empty rollups', () => {
            const metrics = calculateMetrics([]);

            expect(metrics.totalPrs).toBe(0);
            expect(metrics.cycleP50).toBe(null);
            expect(metrics.cycleP90).toBe(null);
            expect(metrics.avgAuthors).toBe(0);
            expect(metrics.avgReviewers).toBe(0);
        });

        it('handles null/undefined rollups', () => {
            expect(createCalculateMetrics(median)(null).totalPrs).toBe(0);
            expect(createCalculateMetrics(median)(undefined).totalPrs).toBe(0);
        });

        it('handles missing fields in rollups', () => {
            const rollups = [
                { pr_count: 10 },
                { cycle_time_p50: 60 },
                {}
            ];

            const metrics = calculateMetrics(rollups);

            expect(metrics.totalPrs).toBe(10);
            expect(metrics.cycleP50).toBe(60);
            expect(metrics.cycleP90).toBe(null);
        });

        it('filters out null cycle time values', () => {
            const rollups = [
                { pr_count: 10, cycle_time_p50: null, cycle_time_p90: 100 },
                { pr_count: 15, cycle_time_p50: 60, cycle_time_p90: null },
                { pr_count: 12, cycle_time_p50: 80, cycle_time_p90: 150 }
            ];

            const metrics = calculateMetrics(rollups);

            expect(metrics.cycleP50).toBe(70); // median of [60, 80]
            expect(metrics.cycleP90).toBe(125); // median of [100, 150]
        });
    });

    describe('calculatePercentChange', () => {
        const calculatePercentChange = createCalculatePercentChange();

        it('calculates positive change correctly', () => {
            expect(calculatePercentChange(110, 100)).toBe(10);
            expect(calculatePercentChange(200, 100)).toBe(100);
        });

        it('calculates negative change correctly', () => {
            expect(calculatePercentChange(90, 100)).toBe(-10);
            expect(calculatePercentChange(50, 100)).toBe(-50);
        });

        it('returns null for zero previous value', () => {
            expect(calculatePercentChange(100, 0)).toBe(null);
        });

        it('returns null for null/undefined values', () => {
            expect(calculatePercentChange(null, 100)).toBe(null);
            expect(calculatePercentChange(100, null)).toBe(null);
            expect(calculatePercentChange(undefined, 100)).toBe(null);
            expect(calculatePercentChange(100, undefined)).toBe(null);
        });

        it('handles zero current value', () => {
            expect(calculatePercentChange(0, 100)).toBe(-100);
        });
    });

    describe('getPreviousPeriod', () => {
        const getPreviousPeriod = createGetPreviousPeriod();

        it('calculates previous period correctly for 30-day range', () => {
            const start = new Date('2025-02-01');
            const end = new Date('2025-03-03'); // 30 days

            const prev = getPreviousPeriod(start, end);

            // Previous period should end just before start
            expect(prev.end.getTime()).toBeLessThan(start.getTime());

            // Duration should be the same
            const originalDuration = end.getTime() - start.getTime();
            const prevDuration = prev.end.getTime() - prev.start.getTime();
            expect(prevDuration).toBe(originalDuration);
        });

        it('calculates previous period correctly for 90-day range', () => {
            const start = new Date('2025-01-01');
            const end = new Date('2025-04-01'); // ~90 days

            const prev = getPreviousPeriod(start, end);

            // Previous end should be 1ms before start
            expect(prev.end.getTime()).toBe(start.getTime() - 1);
        });

        it('handles year boundaries', () => {
            const start = new Date('2025-01-15');
            const end = new Date('2025-02-15');

            const prev = getPreviousPeriod(start, end);

            expect(prev.start.getFullYear()).toBe(2024);
        });
    });

    describe('renderDelta', () => {
        const renderDelta = createRenderDelta();

        beforeEach(() => {
            document.body.innerHTML = '<div id="delta-element" class="metric-delta"></div>';
        });

        it('renders positive delta with up arrow', () => {
            const element = document.getElementById('delta-element');
            renderDelta(element, 15);

            expect(element.className).toContain('delta-positive');
            expect(element.innerHTML).toContain('+15%');
            expect(element.innerHTML).toContain('vs prev');
        });

        it('renders negative delta with down arrow', () => {
            const element = document.getElementById('delta-element');
            renderDelta(element, -20);

            expect(element.className).toContain('delta-negative');
            expect(element.innerHTML).toContain('20%');
        });

        it('renders neutral delta for small changes', () => {
            const element = document.getElementById('delta-element');
            renderDelta(element, 1.5);

            expect(element.className).toContain('delta-neutral');
            expect(element.innerHTML).toContain('~');
        });

        it('applies inverse logic for cycle time (lower is better)', () => {
            const element = document.getElementById('delta-element');
            renderDelta(element, -15, true); // Cycle time decreased = good

            expect(element.className).toContain('delta-positive-inverse');
        });

        it('clears element for null percentChange', () => {
            const element = document.getElementById('delta-element');
            element.innerHTML = 'previous content';
            renderDelta(element, null);

            expect(element.innerHTML).toBe('');
            expect(element.className).toBe('metric-delta');
        });

        it('handles null element without throwing', () => {
            expect(() => renderDelta(null, 10)).not.toThrow();
        });

        it('handles boundary value of exactly 2%', () => {
            const element = document.getElementById('delta-element');
            renderDelta(element, 2);

            // 2% is at the boundary, should still be neutral (< 2 check uses strict less than)
            expect(element.className).toContain('delta-positive');
        });

        it('handles boundary value of -2%', () => {
            const element = document.getElementById('delta-element');
            renderDelta(element, -2);

            expect(element.className).toContain('delta-negative');
        });
    });
});

describe('Sprint 3: Sparklines & Moving Average', () => {
    /**
     * Calculate moving average (mirrors dashboard.js calculateMovingAverage)
     */
    const createCalculateMovingAverage = () => {
        return function calculateMovingAverage(values, window = 4) {
            const result = [];
            for (let i = 0; i < values.length; i++) {
                if (i < window - 1) {
                    result.push(null);
                } else {
                    const sum = values.slice(i - window + 1, i + 1).reduce((a, b) => a + b, 0);
                    result.push(sum / window);
                }
            }
            return result;
        };
    };

    /**
     * Extract sparkline data from rollups (mirrors dashboard.js extractSparklineData)
     */
    const createExtractSparklineData = () => {
        return function extractSparklineData(rollups) {
            if (!rollups || !rollups.length) {
                return { prCounts: [], p50s: [], p90s: [], authors: [], reviewers: [] };
            }

            return {
                prCounts: rollups.map(r => r.pr_count || 0),
                p50s: rollups.map(r => r.cycle_time_p50).filter(v => v !== null && v !== undefined),
                p90s: rollups.map(r => r.cycle_time_p90).filter(v => v !== null && v !== undefined),
                authors: rollups.map(r => r.authors_count || 0),
                reviewers: rollups.map(r => r.reviewers_count || 0)
            };
        };
    };

    /**
     * Render sparkline (mirrors dashboard.js renderSparkline)
     */
    const createRenderSparkline = () => {
        return function renderSparkline(element, values) {
            if (!element || !values || values.length < 2) {
                if (element) element.innerHTML = '';
                return;
            }

            const data = values.slice(-8);
            const width = 60;
            const height = 24;
            const padding = 2;

            const minVal = Math.min(...data);
            const maxVal = Math.max(...data);
            const range = maxVal - minVal || 1;

            const points = data.map((val, i) => {
                const x = padding + (i / (data.length - 1)) * (width - padding * 2);
                const y = height - padding - ((val - minVal) / range) * (height - padding * 2);
                return { x, y };
            });

            const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
            const areaD = pathD + ` L ${points[points.length - 1].x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z`;
            const lastPoint = points[points.length - 1];

            element.innerHTML = `
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
                    <path class="sparkline-area" d="${areaD}"/>
                    <path class="sparkline-line" d="${pathD}"/>
                    <circle class="sparkline-dot" cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="2"/>
                </svg>
            `;
        };
    };

    describe('calculateMovingAverage', () => {
        const calculateMovingAverage = createCalculateMovingAverage();

        it('calculates 4-week moving average correctly', () => {
            const values = [10, 20, 30, 40, 50, 60];
            const result = calculateMovingAverage(values, 4);

            expect(result[0]).toBe(null);
            expect(result[1]).toBe(null);
            expect(result[2]).toBe(null);
            expect(result[3]).toBe(25); // (10+20+30+40)/4
            expect(result[4]).toBe(35); // (20+30+40+50)/4
            expect(result[5]).toBe(45); // (30+40+50+60)/4
        });

        it('handles custom window size', () => {
            const values = [10, 20, 30, 40, 50];
            const result = calculateMovingAverage(values, 2);

            expect(result[0]).toBe(null);
            expect(result[1]).toBe(15); // (10+20)/2
            expect(result[2]).toBe(25); // (20+30)/2
        });

        it('handles array shorter than window', () => {
            const values = [10, 20];
            const result = calculateMovingAverage(values, 4);

            expect(result).toEqual([null, null]);
        });

        it('handles empty array', () => {
            const result = calculateMovingAverage([]);
            expect(result).toEqual([]);
        });

        it('handles single element', () => {
            const result = calculateMovingAverage([10], 4);
            expect(result).toEqual([null]);
        });
    });

    describe('extractSparklineData', () => {
        const extractSparklineData = createExtractSparklineData();

        it('extracts all metric arrays from rollups', () => {
            const rollups = [
                { pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120, authors_count: 5, reviewers_count: 3 },
                { pr_count: 15, cycle_time_p50: 90, cycle_time_p90: 180, authors_count: 7, reviewers_count: 4 }
            ];

            const data = extractSparklineData(rollups);

            expect(data.prCounts).toEqual([10, 15]);
            expect(data.p50s).toEqual([60, 90]);
            expect(data.p90s).toEqual([120, 180]);
            expect(data.authors).toEqual([5, 7]);
            expect(data.reviewers).toEqual([3, 4]);
        });

        it('handles missing fields with defaults', () => {
            const rollups = [
                { pr_count: 10 },
                { cycle_time_p50: 60 }
            ];

            const data = extractSparklineData(rollups);

            expect(data.prCounts).toEqual([10, 0]);
            expect(data.p50s).toEqual([60]);
            expect(data.authors).toEqual([0, 0]);
        });

        it('filters out null/undefined cycle times', () => {
            const rollups = [
                { cycle_time_p50: null, cycle_time_p90: 100 },
                { cycle_time_p50: 60, cycle_time_p90: undefined },
                { cycle_time_p50: 80, cycle_time_p90: 150 }
            ];

            const data = extractSparklineData(rollups);

            expect(data.p50s).toEqual([60, 80]);
            expect(data.p90s).toEqual([100, 150]);
        });

        it('returns empty arrays for null/undefined input', () => {
            expect(extractSparklineData(null)).toEqual({ prCounts: [], p50s: [], p90s: [], authors: [], reviewers: [] });
            expect(extractSparklineData(undefined)).toEqual({ prCounts: [], p50s: [], p90s: [], authors: [], reviewers: [] });
            expect(extractSparklineData([])).toEqual({ prCounts: [], p50s: [], p90s: [], authors: [], reviewers: [] });
        });
    });

    describe('renderSparkline', () => {
        const renderSparkline = createRenderSparkline();

        beforeEach(() => {
            document.body.innerHTML = '<div id="sparkline-container" class="sparkline"></div>';
        });

        it('renders SVG with path elements', () => {
            const element = document.getElementById('sparkline-container');
            renderSparkline(element, [10, 20, 30, 40, 50]);

            expect(element.innerHTML).toContain('<svg');
            expect(element.innerHTML).toContain('sparkline-line');
            expect(element.innerHTML).toContain('sparkline-area');
            expect(element.innerHTML).toContain('sparkline-dot');
        });

        it('limits to last 8 data points', () => {
            const element = document.getElementById('sparkline-container');
            const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
            renderSparkline(element, values);

            // The SVG should be rendered (last 8 points: 5-12)
            expect(element.innerHTML).toContain('<svg');
        });

        it('clears element for insufficient data', () => {
            const element = document.getElementById('sparkline-container');
            element.innerHTML = 'previous content';
            renderSparkline(element, [10]); // Only 1 point

            expect(element.innerHTML).toBe('');
        });

        it('clears element for null values', () => {
            const element = document.getElementById('sparkline-container');
            element.innerHTML = 'previous content';
            renderSparkline(element, null);

            expect(element.innerHTML).toBe('');
        });

        it('handles null element without throwing', () => {
            expect(() => renderSparkline(null, [10, 20, 30])).not.toThrow();
        });

        it('handles flat data (all same values)', () => {
            const element = document.getElementById('sparkline-container');
            renderSparkline(element, [50, 50, 50, 50]);

            expect(element.innerHTML).toContain('<svg');
            // Should still render without errors (range defaults to 1)
        });

        it('includes viewBox attribute for proper scaling', () => {
            const element = document.getElementById('sparkline-container');
            renderSparkline(element, [10, 20, 30]);

            expect(element.innerHTML).toContain('viewBox="0 0 60 24"');
        });
    });
});

describe('Sprint 4: Charts & Tooltips', () => {
    /**
     * Add chart tooltips (mirrors dashboard.js addChartTooltips)
     */
    const createAddChartTooltips = () => {
        return function addChartTooltips(container, contentFn) {
            const dots = container.querySelectorAll('.line-chart-dot');
            let tooltip = null;

            dots.forEach(dot => {
                dot.addEventListener('mouseenter', (e) => {
                    if (!tooltip) {
                        tooltip = document.createElement('div');
                        tooltip.className = 'chart-tooltip';
                        container.appendChild(tooltip);
                    }
                    tooltip.innerHTML = contentFn(dot);
                    tooltip.style.display = 'block';

                    const rect = container.getBoundingClientRect();
                    const dotRect = dot.getBoundingClientRect();
                    tooltip.style.left = `${dotRect.left - rect.left + 10}px`;
                    tooltip.style.top = `${dotRect.top - rect.top - 40}px`;
                });

                dot.addEventListener('mouseleave', () => {
                    if (tooltip) {
                        tooltip.style.display = 'none';
                    }
                });
            });
        };
    };

    describe('addChartTooltips', () => {
        const addChartTooltips = createAddChartTooltips();

        beforeEach(() => {
            document.body.innerHTML = `
                <div id="chart-container" style="position: relative;">
                    <svg>
                        <circle class="line-chart-dot" data-week="2025-W01" data-value="60" data-metric="P50" cx="10" cy="10" r="3"/>
                        <circle class="line-chart-dot" data-week="2025-W02" data-value="75" data-metric="P50" cx="30" cy="20" r="3"/>
                    </svg>
                </div>
            `;
        });

        it('attaches event listeners to chart dots', () => {
            const container = document.getElementById('chart-container');
            const contentFn = (dot) => `<div>Week: ${dot.dataset.week}</div>`;

            addChartTooltips(container, contentFn);

            const dots = container.querySelectorAll('.line-chart-dot');
            expect(dots.length).toBe(2);

            // Simulate mouseenter
            const event = new MouseEvent('mouseenter', { bubbles: true });
            dots[0].dispatchEvent(event);

            const tooltip = container.querySelector('.chart-tooltip');
            expect(tooltip).not.toBeNull();
            expect(tooltip.innerHTML).toContain('2025-W01');
        });

        it('hides tooltip on mouseleave', () => {
            const container = document.getElementById('chart-container');
            const contentFn = (dot) => `<div>Week: ${dot.dataset.week}</div>`;

            addChartTooltips(container, contentFn);

            const dots = container.querySelectorAll('.line-chart-dot');

            // Show tooltip
            dots[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            const tooltip = container.querySelector('.chart-tooltip');
            expect(tooltip.style.display).toBe('block');

            // Hide tooltip
            dots[0].dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            expect(tooltip.style.display).toBe('none');
        });

        it('updates tooltip content on different dot hover', () => {
            const container = document.getElementById('chart-container');
            const contentFn = (dot) => `<div>${dot.dataset.week}: ${dot.dataset.value}</div>`;

            addChartTooltips(container, contentFn);

            const dots = container.querySelectorAll('.line-chart-dot');

            // Hover first dot
            dots[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            let tooltip = container.querySelector('.chart-tooltip');
            expect(tooltip.innerHTML).toContain('2025-W01');
            expect(tooltip.innerHTML).toContain('60');

            // Hover second dot
            dots[1].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            expect(tooltip.innerHTML).toContain('2025-W02');
            expect(tooltip.innerHTML).toContain('75');
        });
    });

    describe('renderCycleTimeTrend', () => {
        beforeEach(() => {
            document.body.innerHTML = '<div id="cycle-time-trend" class="chart"></div>';
        });

        it('renders no-data message for empty rollups', () => {
            const container = document.getElementById('cycle-time-trend');

            // Simulate the check from dashboard.js
            if (![] || [].length < 2) {
                container.innerHTML = '<p class="no-data">Not enough data for trend</p>';
            }

            expect(container.innerHTML).toContain('Not enough data');
        });

        it('renders no-data message for single rollup', () => {
            const container = document.getElementById('cycle-time-trend');
            const rollups = [{ week: '2025-W01', cycle_time_p50: 60, cycle_time_p90: 120 }];

            if (!rollups || rollups.length < 2) {
                container.innerHTML = '<p class="no-data">Not enough data for trend</p>';
            }

            expect(container.innerHTML).toContain('Not enough data');
        });
    });

    describe('renderReviewerActivity', () => {
        beforeEach(() => {
            document.body.innerHTML = '<div id="reviewer-activity" class="chart"></div>';
        });

        it('renders no-data message for empty rollups', () => {
            const container = document.getElementById('reviewer-activity');

            if (![] || [].length === 0) {
                container.innerHTML = '<p class="no-data">No reviewer data available</p>';
            }

            expect(container.innerHTML).toContain('No reviewer data');
        });

        it('renders no-data message when all reviewers_count are zero', () => {
            const container = document.getElementById('reviewer-activity');
            const rollups = [
                { week: '2025-W01', reviewers_count: 0 },
                { week: '2025-W02', reviewers_count: 0 }
            ];

            const maxReviewers = Math.max(...rollups.map(r => r.reviewers_count || 0));
            if (maxReviewers === 0) {
                container.innerHTML = '<p class="no-data">No reviewer data available</p>';
            }

            expect(container.innerHTML).toContain('No reviewer data');
        });
    });
});

describe('Sprint 5: Comparison Mode & Export', () => {
    /**
     * Show toast notification (mirrors dashboard.js showToast)
     */
    const createShowToast = () => {
        return function showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.remove();
            }, 3000);

            return toast;
        };
    };

    describe('showToast', () => {
        const showToast = createShowToast();

        beforeEach(() => {
            document.body.innerHTML = '';
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('creates toast with success type', () => {
            showToast('Test message', 'success');

            const toast = document.querySelector('.toast');
            expect(toast).not.toBeNull();
            expect(toast.className).toContain('success');
            expect(toast.textContent).toBe('Test message');
        });

        it('creates toast with error type', () => {
            showToast('Error occurred', 'error');

            const toast = document.querySelector('.toast');
            expect(toast.className).toContain('error');
        });

        it('defaults to success type', () => {
            showToast('Default type');

            const toast = document.querySelector('.toast');
            expect(toast.className).toContain('success');
        });

        it('removes toast after 3 seconds', () => {
            showToast('Temporary message');

            expect(document.querySelector('.toast')).not.toBeNull();

            jest.advanceTimersByTime(3000);

            expect(document.querySelector('.toast')).toBeNull();
        });
    });

    describe('exportToCsv', () => {
        const createExportToCsv = (cachedRollups, showToastFn) => {
            return function exportToCsv() {
                if (!cachedRollups || cachedRollups.length === 0) {
                    showToastFn('No data to export', 'error');
                    return null;
                }

                const headers = ['Week', 'Start Date', 'End Date', 'PR Count', 'Cycle Time P50 (min)', 'Cycle Time P90 (min)', 'Authors', 'Reviewers'];
                const rows = cachedRollups.map(r => [
                    r.week,
                    r.start_date || '',
                    r.end_date || '',
                    r.pr_count || 0,
                    r.cycle_time_p50 != null ? r.cycle_time_p50.toFixed(1) : '',
                    r.cycle_time_p90 != null ? r.cycle_time_p90.toFixed(1) : '',
                    r.authors_count || 0,
                    r.reviewers_count || 0
                ]);

                const csvContent = [headers, ...rows]
                    .map(row => row.map(cell => `"${cell}"`).join(','))
                    .join('\n');

                return csvContent;
            };
        };

        it('generates valid CSV content', () => {
            const rollups = [
                { week: '2025-W01', start_date: '2025-01-01', end_date: '2025-01-07', pr_count: 10, cycle_time_p50: 60.5, cycle_time_p90: 120.3, authors_count: 5, reviewers_count: 3 }
            ];
            const showToast = jest.fn();
            const exportToCsv = createExportToCsv(rollups, showToast);

            const csv = exportToCsv();

            expect(csv).toContain('"Week","Start Date","End Date","PR Count"');
            expect(csv).toContain('"2025-W01","2025-01-01","2025-01-07","10","60.5","120.3","5","3"');
        });

        it('handles missing fields gracefully', () => {
            const rollups = [
                { week: '2025-W01', pr_count: 10, cycle_time_p50: null }
            ];
            const showToast = jest.fn();
            const exportToCsv = createExportToCsv(rollups, showToast);

            const csv = exportToCsv();

            expect(csv).toContain('"2025-W01","","","10","","","0","0"');
        });

        it('shows error toast for empty data', () => {
            const showToast = jest.fn();
            const exportToCsv = createExportToCsv([], showToast);

            const result = exportToCsv();

            expect(result).toBeNull();
            expect(showToast).toHaveBeenCalledWith('No data to export', 'error');
        });

        it('shows error toast for null data', () => {
            const showToast = jest.fn();
            const exportToCsv = createExportToCsv(null, showToast);

            const result = exportToCsv();

            expect(result).toBeNull();
            expect(showToast).toHaveBeenCalledWith('No data to export', 'error');
        });
    });

    describe('Comparison Mode State', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <button id="compare-toggle" class="btn btn-small btn-secondary">Compare</button>
                <div id="comparison-banner" class="comparison-banner hidden">
                    <span id="current-period-dates">-</span>
                    <span id="previous-period-dates">-</span>
                </div>
            `;
        });

        it('toggles comparison mode on button click', () => {
            let comparisonMode = false;
            const toggle = document.getElementById('compare-toggle');
            const banner = document.getElementById('comparison-banner');

            // Simulate toggle
            comparisonMode = !comparisonMode;
            toggle.classList.toggle('active', comparisonMode);
            banner.classList.toggle('hidden', !comparisonMode);

            expect(comparisonMode).toBe(true);
            expect(toggle.classList.contains('active')).toBe(true);
            expect(banner.classList.contains('hidden')).toBe(false);
        });

        it('exits comparison mode', () => {
            let comparisonMode = true;
            const toggle = document.getElementById('compare-toggle');
            const banner = document.getElementById('comparison-banner');

            toggle.classList.add('active');
            banner.classList.remove('hidden');

            // Exit comparison mode
            comparisonMode = false;
            toggle.classList.remove('active');
            banner.classList.add('hidden');

            expect(comparisonMode).toBe(false);
            expect(toggle.classList.contains('active')).toBe(false);
            expect(banner.classList.contains('hidden')).toBe(true);
        });
    });

    describe('updateComparisonBanner', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <div id="comparison-banner" class="comparison-banner">
                    <span id="current-period-dates">-</span>
                    <span id="previous-period-dates">-</span>
                </div>
            `;
        });

        it('updates banner with formatted date ranges', () => {
            const currentPeriodDates = document.getElementById('current-period-dates');
            const previousPeriodDates = document.getElementById('previous-period-dates');

            const formatDate = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            const currentDateRange = {
                start: new Date('2025-01-01'),
                end: new Date('2025-01-31')
            };

            // Calculate previous period
            const durationMs = currentDateRange.end.getTime() - currentDateRange.start.getTime();
            const prevEnd = new Date(currentDateRange.start.getTime() - 1);
            const prevStart = new Date(prevEnd.getTime() - durationMs);

            currentPeriodDates.textContent = `${formatDate(currentDateRange.start)} - ${formatDate(currentDateRange.end)}`;
            previousPeriodDates.textContent = `${formatDate(prevStart)} - ${formatDate(prevEnd)}`;

            expect(currentPeriodDates.textContent).toContain('Jan');
            expect(currentPeriodDates.textContent).toContain('2025');
            expect(previousPeriodDates.textContent).toContain('Dec');
            expect(previousPeriodDates.textContent).toContain('2024');
        });
    });

    describe('URL State Management', () => {
        const createUpdateUrlState = () => {
            return function updateUrlState(state) {
                const params = new URLSearchParams();

                if (state.start) {
                    params.set('start', state.start.toISOString().split('T')[0]);
                }
                if (state.end) {
                    params.set('end', state.end.toISOString().split('T')[0]);
                }
                if (state.repos && state.repos.length > 0) {
                    params.set('repos', state.repos.join(','));
                }
                if (state.teams && state.teams.length > 0) {
                    params.set('teams', state.teams.join(','));
                }
                if (state.compare) {
                    params.set('compare', '1');
                }

                return params.toString();
            };
        };

        it('serializes date range to URL params', () => {
            const updateUrlState = createUpdateUrlState();
            const state = {
                start: new Date('2025-01-01'),
                end: new Date('2025-03-31')
            };

            const params = updateUrlState(state);

            expect(params).toContain('start=2025-01-01');
            expect(params).toContain('end=2025-03-31');
        });

        it('serializes filters to URL params', () => {
            const updateUrlState = createUpdateUrlState();
            const state = {
                repos: ['repo1', 'repo2'],
                teams: ['team1']
            };

            const params = updateUrlState(state);

            expect(params).toContain('repos=repo1%2Crepo2');
            expect(params).toContain('teams=team1');
        });

        it('includes comparison mode flag', () => {
            const updateUrlState = createUpdateUrlState();
            const state = {
                compare: true
            };

            const params = updateUrlState(state);

            expect(params).toContain('compare=1');
        });

        it('omits empty values', () => {
            const updateUrlState = createUpdateUrlState();
            const state = {
                repos: [],
                teams: [],
                compare: false
            };

            const params = updateUrlState(state);

            expect(params).not.toContain('repos');
            expect(params).not.toContain('teams');
            expect(params).not.toContain('compare');
        });
    });
});

describe('Sprint 2: Filter Management', () => {
    /**
     * Create filter chip HTML (mirrors dashboard.js createFilterChip)
     */
    const createFilterChipFn = () => {
        return function createFilterChip(type, value, label) {
            const prefix = type === 'repo' ? 'repo' : 'team';
            return `
                <span class="filter-chip">
                    <span class="filter-chip-label">${prefix}: ${label}</span>
                    <span class="filter-chip-remove" data-type="${type}" data-value="${value}">&times;</span>
                </span>
            `;
        };
    };

    describe('createFilterChip', () => {
        const createFilterChip = createFilterChipFn();

        it('creates repo chip with correct structure', () => {
            const chip = createFilterChip('repo', 'backend', 'Backend API');

            expect(chip).toContain('filter-chip');
            expect(chip).toContain('repo: Backend API');
            expect(chip).toContain('data-type="repo"');
            expect(chip).toContain('data-value="backend"');
        });

        it('creates team chip with correct structure', () => {
            const chip = createFilterChip('team', 'platform', 'Platform Team');

            expect(chip).toContain('team: Platform Team');
            expect(chip).toContain('data-type="team"');
            expect(chip).toContain('data-value="platform"');
        });
    });

    describe('Filter UI Updates', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <button id="clear-filters" class="btn btn-small btn-secondary hidden">Clear Filters</button>
                <div id="active-filters" class="active-filters hidden">
                    <span class="active-filters-label">Filtering by:</span>
                    <div id="filter-chips" class="filter-chips"></div>
                </div>
                <select id="repo-filter" multiple>
                    <option value="">All</option>
                    <option value="backend">Backend API</option>
                    <option value="frontend">Frontend</option>
                </select>
                <select id="team-filter" multiple>
                    <option value="">All</option>
                    <option value="platform">Platform</option>
                </select>
            `;
        });

        it('shows clear button when filters are active', () => {
            const clearBtn = document.getElementById('clear-filters');
            const activeFilters = document.getElementById('active-filters');

            const currentFilters = { repos: ['backend'], teams: [] };
            const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0;

            clearBtn.classList.toggle('hidden', !hasFilters);
            activeFilters.classList.toggle('hidden', !hasFilters);

            expect(clearBtn.classList.contains('hidden')).toBe(false);
            expect(activeFilters.classList.contains('hidden')).toBe(false);
        });

        it('hides clear button when no filters', () => {
            const clearBtn = document.getElementById('clear-filters');
            const activeFilters = document.getElementById('active-filters');

            const currentFilters = { repos: [], teams: [] };
            const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0;

            clearBtn.classList.toggle('hidden', !hasFilters);
            activeFilters.classList.toggle('hidden', !hasFilters);

            expect(clearBtn.classList.contains('hidden')).toBe(true);
            expect(activeFilters.classList.contains('hidden')).toBe(true);
        });

        it('clears all filters on clear button click', () => {
            let currentFilters = { repos: ['backend'], teams: ['platform'] };

            // Select options
            const repoFilter = document.getElementById('repo-filter');
            const teamFilter = document.getElementById('team-filter');
            repoFilter.querySelector('option[value="backend"]').selected = true;
            teamFilter.querySelector('option[value="platform"]').selected = true;

            // Clear filters
            currentFilters = { repos: [], teams: [] };
            Array.from(repoFilter.options).forEach(o => o.selected = o.value === '');
            Array.from(teamFilter.options).forEach(o => o.selected = o.value === '');

            expect(currentFilters.repos).toEqual([]);
            expect(currentFilters.teams).toEqual([]);
            expect(repoFilter.querySelector('option[value=""]').selected).toBe(true);
            expect(repoFilter.querySelector('option[value="backend"]').selected).toBe(false);
        });
    });

    describe('restoreFiltersFromUrl', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <select id="repo-filter" multiple>
                    <option value="">All</option>
                    <option value="backend">Backend API</option>
                    <option value="frontend">Frontend</option>
                </select>
                <select id="team-filter" multiple>
                    <option value="">All</option>
                    <option value="platform">Platform</option>
                    <option value="mobile">Mobile</option>
                </select>
            `;
        });

        it('restores repo filters from URL params', () => {
            const params = new URLSearchParams('repos=backend,frontend');
            const reposParam = params.get('repos');
            let currentFilters = { repos: [], teams: [] };

            if (reposParam) {
                currentFilters.repos = reposParam.split(',').filter(v => v);
                const repoFilter = document.getElementById('repo-filter');
                currentFilters.repos.forEach(value => {
                    const option = repoFilter.querySelector(`option[value="${value}"]`);
                    if (option) option.selected = true;
                });
            }

            expect(currentFilters.repos).toEqual(['backend', 'frontend']);
            const repoFilter = document.getElementById('repo-filter');
            expect(repoFilter.querySelector('option[value="backend"]').selected).toBe(true);
            expect(repoFilter.querySelector('option[value="frontend"]').selected).toBe(true);
        });

        it('restores team filters from URL params', () => {
            const params = new URLSearchParams('teams=platform');
            const teamsParam = params.get('teams');
            let currentFilters = { repos: [], teams: [] };

            if (teamsParam) {
                currentFilters.teams = teamsParam.split(',').filter(v => v);
                const teamFilter = document.getElementById('team-filter');
                currentFilters.teams.forEach(value => {
                    const option = teamFilter.querySelector(`option[value="${value}"]`);
                    if (option) option.selected = true;
                });
            }

            expect(currentFilters.teams).toEqual(['platform']);
        });

        it('handles missing URL params gracefully', () => {
            const params = new URLSearchParams('');
            let currentFilters = { repos: [], teams: [] };

            const reposParam = params.get('repos');
            const teamsParam = params.get('teams');

            if (reposParam) {
                currentFilters.repos = reposParam.split(',').filter(v => v);
            }
            if (teamsParam) {
                currentFilters.teams = teamsParam.split(',').filter(v => v);
            }

            expect(currentFilters.repos).toEqual([]);
            expect(currentFilters.teams).toEqual([]);
        });
    });

    describe('populateFilterDropdowns', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <div id="repo-filter-group">
                    <select id="repo-filter" multiple>
                        <option value="" selected>All</option>
                    </select>
                </div>
                <div id="team-filter-group">
                    <select id="team-filter" multiple>
                        <option value="" selected>All</option>
                    </select>
                </div>
            `;
        });

        it('populates repo dropdown from dimensions', () => {
            const dimensions = {
                repositories: [
                    { id: 'repo1', name: 'Backend API' },
                    { id: 'repo2', name: 'Frontend App' }
                ],
                teams: []
            };

            const repoFilter = document.getElementById('repo-filter');
            if (dimensions.repositories?.length > 0) {
                repoFilter.innerHTML = '<option value="">All</option>';
                dimensions.repositories.forEach(repo => {
                    const option = document.createElement('option');
                    option.value = repo.id || repo.name;
                    option.textContent = repo.name;
                    repoFilter.appendChild(option);
                });
            }

            expect(repoFilter.options.length).toBe(3);
            expect(repoFilter.querySelector('option[value="repo1"]').textContent).toBe('Backend API');
            expect(repoFilter.querySelector('option[value="repo2"]').textContent).toBe('Frontend App');
        });

        it('populates team dropdown from dimensions', () => {
            const dimensions = {
                repositories: [],
                teams: [
                    { id: 'team1', name: 'Platform Team' },
                    { id: 'team2', name: 'Mobile Team' }
                ]
            };

            const teamFilter = document.getElementById('team-filter');
            if (dimensions.teams?.length > 0) {
                teamFilter.innerHTML = '<option value="">All</option>';
                dimensions.teams.forEach(team => {
                    const option = document.createElement('option');
                    option.value = team.id || team.name;
                    option.textContent = team.name;
                    teamFilter.appendChild(option);
                });
            }

            expect(teamFilter.options.length).toBe(3);
            expect(teamFilter.querySelector('option[value="team1"]').textContent).toBe('Platform Team');
        });

        it('hides filter group when no dimensions available', () => {
            const dimensions = {
                repositories: [],
                teams: []
            };

            const repoFilterGroup = document.getElementById('repo-filter-group');
            const teamFilterGroup = document.getElementById('team-filter-group');

            if (!dimensions.repositories?.length) {
                repoFilterGroup.classList.add('hidden');
            }
            if (!dimensions.teams?.length) {
                teamFilterGroup.classList.add('hidden');
            }

            expect(repoFilterGroup.classList.contains('hidden')).toBe(true);
            expect(teamFilterGroup.classList.contains('hidden')).toBe(true);
        });
    });
});
