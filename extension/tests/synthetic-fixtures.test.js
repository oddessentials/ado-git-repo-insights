/**
 * Consumer-side validation tests for synthetic fixtures.
 *
 * Ensures generated datasets can be loaded by the extension UI.
 */

const { DatasetLoader } = require('../ui/dataset-loader');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('Synthetic Fixture Consumer Validation', () => {
    let fixtureDir;

    beforeAll(() => {
        // Create temp directory for fixtures
        fixtureDir = path.join(__dirname, '..', '..', 'tmp', 'test-fixtures');
        ensureDir(fixtureDir);
    });

    beforeEach(() => {
        // Configure fetch mock to read file:// URLs from disk
        global.fetch.mockImplementation(async (url) => {
            if (url.startsWith('file://')) {
                const filePath = url.replace('file://', '');
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    return {
                        ok: true,
                        status: 200,
                        json: async () => JSON.parse(content)
                    };
                } catch (err) {
                    if (err.code === 'ENOENT') {
                        return { ok: false, status: 404, statusText: 'Not Found' };
                    }
                    throw err;
                }
            }
            // Non-file URLs return 404 by default
            return { ok: false, status: 404, statusText: 'Not Found' };
        });
    });

    /**
     * Generate a synthetic fixture on-demand.
     */
    function generateFixture(prCount, seed = 42) {
        const outputDir = path.join(fixtureDir, `${prCount}pr-seed${seed}`);

        // Skip if already generated
        if (fs.existsSync(path.join(outputDir, 'dataset-manifest.json'))) {
            return outputDir;
        }

        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'generate-synthetic-dataset.py');

        try {
            execSync(
                `python "${scriptPath}" --pr-count ${prCount} --seed ${seed} --output "${outputDir}"`,
                { stdio: 'pipe' }
            );
        } catch (error) {
            throw new Error(`Failed to generate fixture: ${error.message}`);
        }

        return outputDir;
    }

    function ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    test('1000 PR fixture passes loadManifest validation', async () => {
        const fixturePath = generateFixture(1000, 42);
        const baseUrl = `file://${fixturePath}`;

        const loader = new DatasetLoader(baseUrl);

        // Should not throw
        await expect(loader.loadManifest()).resolves.toBeDefined();
    });

    test('generated manifest has correct schema versions', async () => {
        const fixturePath = generateFixture(1000, 42);
        const manifestPath = path.join(fixturePath, 'dataset-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        expect(manifest.manifest_schema_version).toBe(1);
        expect(manifest.dataset_schema_version).toBe(1);
        expect(manifest.aggregates_schema_version).toBe(1);
    });

    test('generated rollups load successfully', async () => {
        const fixturePath = generateFixture(1000, 42);
        const baseUrl = `file://${fixturePath}`;

        const loader = new DatasetLoader(baseUrl);
        await loader.loadManifest();

        // Get first rollup entry
        const manifest = loader.manifest;
        expect(manifest.aggregate_index.weekly_rollups.length).toBeGreaterThan(0);

        const rollupEntry = manifest.aggregate_index.weekly_rollups[0];
        const rollupPath = path.join(fixturePath, rollupEntry.path);

        expect(fs.existsSync(rollupPath)).toBe(true);

        const rollupData = JSON.parse(fs.readFileSync(rollupPath, 'utf-8'));

        // Validate structure
        expect(rollupData).toHaveProperty('week');
        expect(rollupData).toHaveProperty('pr_count');
        expect(rollupData).toHaveProperty('cycle_time_p50');
    });

    test('generated dimensions load successfully', async () => {
        const fixturePath = generateFixture(1000, 42);
        const baseUrl = `file://${fixturePath}`;

        const loader = new DatasetLoader(baseUrl);
        await loader.loadManifest();

        const dimensions = await loader.loadDimensions();

        expect(dimensions).toHaveProperty('repositories');
        expect(dimensions).toHaveProperty('users');
        expect(dimensions).toHaveProperty('projects');
        expect(dimensions).toHaveProperty('date_range');

        expect(Array.isArray(dimensions.repositories)).toBe(true);
        expect(Array.isArray(dimensions.users)).toBe(true);
    });

    test('5k PR fixture generates successfully', async () => {
        const fixturePath = generateFixture(5000, 42);
        const manifestPath = path.join(fixturePath, 'dataset-manifest.json');

        expect(fs.existsSync(manifestPath)).toBe(true);

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        expect(manifest.coverage.total_prs).toBe(5000);
    });

    test('10k PR fixture generates successfully', async () => {
        const fixturePath = generateFixture(10000, 42);
        const manifestPath = path.join(fixturePath, 'dataset-manifest.json');

        expect(fs.existsSync(manifestPath)).toBe(true);

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        expect(manifest.coverage.total_prs).toBe(10000);
    });

    test('deterministic generation: same seed produces identical manifest structure', async () => {
        const fixture1 = generateFixture(1000, 999);
        const fixture2 = generateFixture(1000, 999);

        const manifest1 = JSON.parse(fs.readFileSync(path.join(fixture1, 'dataset-manifest.json'), 'utf-8'));
        const manifest2 = JSON.parse(fs.readFileSync(path.join(fixture2, 'dataset-manifest.json'), 'utf-8'));

        // Exclude generated_at timestamp
        delete manifest1.generated_at;
        delete manifest2.generated_at;

        expect(manifest1).toEqual(manifest2);
    });
});
