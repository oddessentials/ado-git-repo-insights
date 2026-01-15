#!/usr/bin/env node
/**
 * Update Performance Baselines
 *
 * USAGE: npm run perf:update-baseline
 *
 * WARNING: Only run this from the main branch after confirming
 * all performance tests pass with current baselines.
 *
 * This script:
 * 1. Runs performance tests in trend mode
 * 2. Extracts actual timings from console output
 * 3. Updates perf-baselines.json with new values
 * 4. Requires manual commit
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const baselinesPath = path.join(__dirname, '..', 'tests', 'fixtures', 'perf-baselines.json');

console.log('[PERF] Updating performance baselines...');
console.log('[PERF] Running performance tests to collect actual timings...\n');

// Run performance tests in trend mode and capture output
let testOutput;
try {
    testOutput = execSync('npm test -- performance.test.js --verbose', {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf-8',
        env: { ...process.env, PERF_MODE: 'trend' }
    });
} catch (error) {
    console.error('[ERROR] Performance tests failed. Fix failures before updating baselines.');
    console.error(error.message);
    process.exit(1);
}

// Extract timing data from JSON logs
const timings = {};
const jsonLogs = testOutput.match(/\{[^}]*"test"[^}]*\}/g) || [];

jsonLogs.forEach(log => {
    try {
        const data = JSON.parse(log);
        if (data.test && data.duration_ms) {
            // Map test names to baseline keys
            const testName = data.test;
            let key;

            if (testName.includes('fixture_generation_1000pr')) key = '1000pr_fixture_gen_ms';
            else if (testName.includes('fixture_generation_5000pr')) key = '5000pr_fixture_gen_ms';
            else if (testName.includes('fixture_generation_10000pr')) key = '10000pr_fixture_gen_ms';
            // Add more mappings as needed

            if (key) {
                timings[key] = Math.round(data.duration_ms);
            }
        }
    } catch (e) {
        // Skip malformed JSON
    }
});

if (Object.keys(timings).length === 0) {
    console.error('[ERROR] No timing data extracted from test output.');
    console.error('[ERROR] Make sure tests are outputting JSON logs.');
    process.exit(1);
}

// Load current baselines
let baselines;
try {
    baselines = JSON.parse(fs.readFileSync(baselinesPath, 'utf-8'));
} catch (error) {
    console.error('[ERROR] Failed to read baselines file');
    console.error(error.message);
    process.exit(1);
}

// Update with new timings
console.log('\n[PERF] Updating baselines:\n');
Object.entries(timings).forEach(([key, value]) => {
    const old = baselines.metrics[key];
    baselines.metrics[key] = value;
    console.log(`  ${key}: ${old} → ${value} (${value > old ? '+' : ''}${((value - old) / old * 100).toFixed(1)}%)`);
});

// Update metadata
baselines.updated = new Date().toISOString();
baselines.updatedBy = process.env.USER || process.env.USERNAME || 'manual';

// Write updated baselines
fs.writeFileSync(baselinesPath, JSON.stringify(baselines, null, 2) + '\n');

console.log(`\n[PERF] ✅ Baselines updated successfully`);
console.log(`[PERF] File: ${baselinesPath}`);
console.log(`[PERF] Remember to commit this change!`);
