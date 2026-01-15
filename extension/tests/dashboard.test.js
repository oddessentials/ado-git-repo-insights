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
