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

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(__dirname, '../ui');
const outDir = path.resolve(__dirname, '../dist/ui');

// Safety guard: verify outDir is the expected path before any destructive operations
const EXPECTED_SUFFIX = path.join('dist', 'ui');
if (!outDir.endsWith(EXPECTED_SUFFIX)) {
    console.error(`::error::Safety guard failed: outDir must end with '${EXPECTED_SUFFIX}', got: ${outDir}`);
    process.exit(1);
}

// Clean dist/ui directory before building (prevents stale file accumulation)
// Uses force + retries for Windows reliability with transient file locks
if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    console.log('🧹 Cleaned dist/ui/ directory\n');
}

// Ensure output directory exists
fs.mkdirSync(outDir, { recursive: true });

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

async function build() {
    console.log('📦 Building UI bundles with esbuild...\n');

    for (const entry of entryPoints) {
        const inputPath = path.join(uiDir, entry.input);

        if (!fs.existsSync(inputPath)) {
            console.warn(`⚠ Skipping ${entry.input} (not found)`);
            continue;
        }

        const outputPath = path.join(outDir, entry.output);

        try {
            const result = await esbuild.build({
                entryPoints: [inputPath],
                outfile: outputPath,
                bundle: true,
                format: 'iife',
                globalName: entry.globalName,
                target: 'es2020',
                sourcemap: false,  // No source maps for production bundle
                minify: false,     // Keep readable for debugging
                external: externals,
                logLevel: 'warning',
                // Ensure all exports are accessible on the global
                footer: {
                    js: `// Global exports for browser runtime\nif (typeof window !== 'undefined') { Object.assign(window, ${entry.globalName} || {}); }`,
                },
            });

            if (result.errors.length === 0) {
                const stats = fs.statSync(outputPath);
                console.log(`✓ ${entry.output} (${(stats.size / 1024).toFixed(1)} KB)`);
            }
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
