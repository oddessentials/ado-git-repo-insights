/**
 * esbuild bundler for UI files.
 *
 * Bundles TypeScript UI source files to browser-executable IIFE JavaScript.
 * Output goes to extension/dist/ui/ for packaging in the VSIX and
 * syncing to the Python ui_bundle.
 *
 * Key requirements from CRITICAL.md:
 * - format: 'iife' (no ESM import/export in output)
 * - target: 'es2020' (broad browser support)
 * - bundle: true (resolve all imports)
 * - Expose globals for HTML script tag consumption
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const uiDir = path.resolve(__dirname, '../ui');
const outDir = path.resolve(__dirname, '../dist/ui');
const esbuildCliPath = require.resolve('esbuild/bin/esbuild');
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

// Safety guard: verify outDir is the expected path before any destructive operations
const EXPECTED_SUFFIX = path.join('dist', 'ui');
if (!outDir.endsWith(EXPECTED_SUFFIX)) {
    console.error(`::error::Safety guard failed: outDir must end with '${EXPECTED_SUFFIX}', got: ${outDir}`);
    process.exit(1);
}

// Entry points for UI bundles
const entryPoints = [
    { input: 'dashboard.ts', output: 'dashboard.js', globalName: 'PRInsightsDashboard' },
    { input: 'settings.ts', output: 'settings.js', globalName: 'PRInsightsSettings' },
    { input: 'dataset-loader.ts', output: 'dataset-loader.js', globalName: 'PRInsightsDatasetLoader' },
    { input: 'artifact-client.ts', output: 'artifact-client.js', globalName: 'PRInsightsArtifactClient' },
    { input: 'error-types.ts', output: 'error-types.js', globalName: 'PRInsightsErrorTypes' },
    { input: 'error-codes.ts', output: 'error-codes.js', globalName: 'PRInsightsErrorCodes' },
];

// External modules that are loaded via script tags (not bundled)
const externals = [];

function removeWithRetries(targetPath) {
    const deadline = Date.now() + 5000;

    while (true) {
        try {
            fs.rmSync(targetPath, {
                recursive: true,
                force: true,
                maxRetries: 3,
                retryDelay: 100,
            });
            return;
        } catch (err) {
            if (
                (err?.code !== 'EPERM' && err?.code !== 'EBUSY') ||
                Date.now() >= deadline
            ) {
                throw err;
            }

            Atomics.wait(sleepBuffer, 0, 0, 200);
        }
    }
}

async function build() {
    // Clean dist/ui contents before building without removing the root directory.
    // On Windows the root can be transiently locked even when child entries are removable.
    fs.mkdirSync(outDir, { recursive: true });
    for (const entry of fs.readdirSync(outDir)) {
        removeWithRetries(path.join(outDir, entry));
    }
    console.log('🧹 Cleaned dist/ui/ directory\n');

    console.log('📦 Building UI bundles with esbuild...\n');

    for (const entry of entryPoints) {
        const inputPath = path.join(uiDir, entry.input);

        if (!fs.existsSync(inputPath)) {
            console.warn(`⚠ Skipping ${entry.input} (not found)`);
            continue;
        }

        const outputPath = path.join(outDir, entry.output);

        try {
            const cliArgs = [
                esbuildCliPath,
                inputPath,
                '--bundle',
                '--format=iife',
                `--global-name=${entry.globalName}`,
                '--target=es2020',
                '--log-level=warning',
                `--outfile=${outputPath}`,
                `--footer:js=// Global exports for browser runtime\\nif (typeof window !== 'undefined') { Object.assign(window, ${entry.globalName} || {}); }`,
                ...externals.map((external) => `--external:${external}`),
            ];

            execFileSync(process.execPath, cliArgs, {
                cwd: __dirname,
                stdio: 'inherit',
            });

            const stats = fs.statSync(outputPath);
            console.log(`✓ ${entry.output} (${(stats.size / 1024).toFixed(1)} KB)`);
        } catch (err) {
            console.error(`✗ Failed to build ${entry.input}:`, err.message);
            process.exit(1);
        }
    }

    // Copy static assets (HTML, CSS, SDK) to dist/ui
    const staticFiles = ['index.html', 'settings.html', 'styles.css', 'VSS.SDK.min.js'];

    console.log('\n📄 Copying static files...');
    for (const file of staticFiles) {
        const srcPath = path.join(uiDir, file);
        const destPath = path.join(outDir, file);

        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`✓ ${file}`);
        }
    }

    console.log('\n✅ UI build complete!');
    console.log(`   Output: ${outDir}`);
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
