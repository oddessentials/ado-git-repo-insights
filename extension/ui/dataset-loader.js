/**
 * Dataset Loader Module
 *
 * Implements the dataset-contract.md specification.
 * This module is the ONLY data layer - fully dataset-driven,
 * usable by both extension UI and future CLI dashboard.
 */

// Supported schema versions (from dataset-contract.md)
const SUPPORTED_MANIFEST_VERSION = 1;
const SUPPORTED_DATASET_VERSION = 1;
const SUPPORTED_AGGREGATES_VERSION = 1;

/**
 * Dataset loader state
 */
class DatasetLoader {
    constructor(baseUrl) {
        this.baseUrl = baseUrl || '';
        this.manifest = null;
        this.dimensions = null;
        this.rollupCache = new Map(); // week -> data
        this.distributionCache = new Map(); // year -> data
    }

    /**
     * Load and validate the dataset manifest.
     * @returns {Promise<Object>} The manifest object
     * @throws {Error} If manifest invalid or incompatible
     */
    async loadManifest() {
        const url = this.resolvePath('dataset-manifest.json');
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Dataset not found. Ensure the analytics pipeline has run successfully.');
            }
            throw new Error(`Failed to load manifest: ${response.status} ${response.statusText}`);
        }

        const manifest = await response.json();
        this.validateManifest(manifest);
        this.manifest = manifest;
        return manifest;
    }

    /**
     * Validate manifest schema versions.
     * @param {Object} manifest
     * @throws {Error} If versions incompatible
     */
    validateManifest(manifest) {
        if (!manifest.manifest_schema_version) {
            throw new Error('Invalid manifest: missing schema version');
        }

        if (manifest.manifest_schema_version > SUPPORTED_MANIFEST_VERSION) {
            throw new Error(
                `Manifest version ${manifest.manifest_schema_version} not supported. ` +
                `Maximum supported: ${SUPPORTED_MANIFEST_VERSION}. ` +
                `Please update the extension.`
            );
        }

        if (manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION) {
            throw new Error(
                `Dataset version ${manifest.dataset_schema_version} not supported. ` +
                `Please update the extension.`
            );
        }

        if (manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION) {
            throw new Error(
                `Aggregates version ${manifest.aggregates_schema_version} not supported. ` +
                `Please update the extension.`
            );
        }
    }

    /**
     * Load dimensions (filter values).
     * @returns {Promise<Object>}
     */
    async loadDimensions() {
        if (this.dimensions) return this.dimensions;

        const url = this.resolvePath('aggregates/dimensions.json');
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to load dimensions: ${response.status}`);
        }

        this.dimensions = await response.json();
        return this.dimensions;
    }

    /**
     * Get weekly rollups for a date range.
     * Implements lazy loading with caching.
     * @param {Date} startDate
     * @param {Date} endDate
     * @returns {Promise<Array>} Array of rollup objects
     */
    async getWeeklyRollups(startDate, endDate) {
        if (!this.manifest) {
            throw new Error('Manifest not loaded. Call loadManifest() first.');
        }

        const neededWeeks = this.getWeeksInRange(startDate, endDate);
        const results = [];

        for (const weekStr of neededWeeks) {
            // Check cache first
            if (this.rollupCache.has(weekStr)) {
                results.push(this.rollupCache.get(weekStr));
                continue;
            }

            // Find in index
            const indexEntry = this.manifest.aggregate_index.weekly_rollups.find(
                r => r.week === weekStr
            );

            if (!indexEntry) {
                // No data for this week, skip
                continue;
            }

            // Fetch and cache
            const url = this.resolvePath(indexEntry.path);
            const response = await fetch(url);

            if (response.ok) {
                const data = await response.json();
                this.rollupCache.set(weekStr, data);
                results.push(data);
            }
        }

        return results.sort((a, b) => a.week.localeCompare(b.week));
    }

    /**
     * Get yearly distributions for a date range.
     * @param {Date} startDate
     * @param {Date} endDate
     * @returns {Promise<Array>}
     */
    async getDistributions(startDate, endDate) {
        if (!this.manifest) {
            throw new Error('Manifest not loaded. Call loadManifest() first.');
        }

        const startYear = startDate.getFullYear();
        const endYear = endDate.getFullYear();
        const results = [];

        for (let year = startYear; year <= endYear; year++) {
            const yearStr = year.toString();

            // Check cache
            if (this.distributionCache.has(yearStr)) {
                results.push(this.distributionCache.get(yearStr));
                continue;
            }

            // Find in index
            const indexEntry = this.manifest.aggregate_index.distributions.find(
                d => d.year === yearStr
            );

            if (!indexEntry) continue;

            // Fetch and cache
            const url = this.resolvePath(indexEntry.path);
            const response = await fetch(url);

            if (response.ok) {
                const data = await response.json();
                this.distributionCache.set(yearStr, data);
                results.push(data);
            }
        }

        return results;
    }

    /**
     * Check if a feature is enabled in the dataset.
     * @param {string} feature - teams, comments, ml, ai_insights
     * @returns {boolean}
     */
    isFeatureEnabled(feature) {
        if (!this.manifest) return false;
        return this.manifest.features?.[feature] === true;
    }

    /**
     * Get dataset coverage info.
     * @returns {Object} { totalPrs, dateRange }
     */
    getCoverage() {
        if (!this.manifest) return null;
        return this.manifest.coverage;
    }

    /**
     * Get default date range days.
     * @returns {number}
     */
    getDefaultRangeDays() {
        return this.manifest?.defaults?.default_date_range_days || 90;
    }

    /**
     * Resolve a relative path to full URL.
     * @param {string} relativePath
     * @returns {string}
     */
    resolvePath(relativePath) {
        if (this.baseUrl) {
            return `${this.baseUrl}/${relativePath}`;
        }
        return relativePath;
    }

    /**
     * Get ISO week strings for a date range.
     * @param {Date} start
     * @param {Date} end
     * @returns {Array<string>} e.g., ['2026-W01', '2026-W02']
     */
    getWeeksInRange(start, end) {
        const weeks = [];
        const current = new Date(start);

        while (current <= end) {
            const weekStr = this.getISOWeek(current);
            if (!weeks.includes(weekStr)) {
                weeks.push(weekStr);
            }
            current.setDate(current.getDate() + 7);
        }

        // Ensure we include the end date's week
        const endWeek = this.getISOWeek(end);
        if (!weeks.includes(endWeek)) {
            weeks.push(endWeek);
        }

        return weeks;
    }

    /**
     * Get ISO week string for a date.
     * @param {Date} date
     * @returns {string} e.g., '2026-W02'
     */
    getISOWeek(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.DatasetLoader = DatasetLoader;
}
if (typeof module !== 'undefined') {
    module.exports = { DatasetLoader };
}
