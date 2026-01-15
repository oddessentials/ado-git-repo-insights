#!/usr/bin/env node
/**
 * CI Guard: Prevent Direct Baseline Edits
 *
 * This script checks if perf-baselines.json was modified directly
 * without going through the approved update script.
 *
 * Exit codes:
 * - 0: OK (baseline unchanged or updated via script)
 * - 1: FAIL (baseline modified directly)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const baselinesPath = 'extension/tests/fixtures/perf-baselines.json';

try {
    // Check if baselines file changed in this commit
    const changedFiles = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf-8' }).trim();

    if (!changedFiles.includes(baselinesPath)) {
        console.log('[CI] ✅ Baselines file unchanged');
        process.exit(0);
    }

    // File changed - verify it was via approved process
    const commitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim();

    // Allow if commit message indicates approved update
    if (commitMessage.includes('chore(perf): update baselines') ||
        commitMessage.includes('[baseline-update]')) {
        console.log('[CI] ✅ Baseline update via approved process');
        process.exit(0);
    }

    // Check if updatedBy field shows manual script usage
    const baselines = JSON.parse(fs.readFileSync(baselinesPath, 'utf-8'));
    const recentUpdate = new Date(baselines.updated);
    const commitDate = new Date(execSync('git log -1 --format=%cI', { encoding: 'utf-8' }).trim());

    // If updated within 5 minutes of commit, likely from script
    const timeDiff = Math.abs(commitDate - recentUpdate);
    if (timeDiff < 5 * 60 * 1000) {
        console.log('[CI] ✅ Baseline timestamp matches commit (likely via script)');
        process.exit(0);
    }

    // Fail - direct edit detected
    console.error('[CI] ❌ BLOCKED: Direct edit to perf-baselines.json detected');
    console.error('[CI] Baselines must be updated via: npm run perf:update-baseline');
    console.error('[CI] Or use commit message: chore(perf): update baselines [baseline-update]');
    process.exit(1);

} catch (error) {
    console.error('[CI] Error checking baselines:', error.message);
    // Fail safe - reject on error
    process.exit(1);
}
