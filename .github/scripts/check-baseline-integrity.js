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

const baselinesPath = 'extension/tests/fixtures/perf-baselines.json';

/**
 * Run git command and return trimmed output.
 */
function git(cmd) {
    try {
        return execSync(`git ${cmd}`, { encoding: 'utf-8' }).trim();
    } catch {
        return '';
    }
}

try {
    // Check if baselines file changed in HEAD~1..HEAD
    const changedFiles = git('diff --name-only HEAD~1 HEAD');

    if (!changedFiles.includes(baselinesPath)) {
        console.log('[CI] ✅ Baselines file unchanged in this commit');
        process.exit(0);
    }

    console.log('[CI] Baselines file changed, checking for approved marker...');

    // Check current commit message
    const commitMessage = git('log -1 --pretty=%B');
    if (commitMessage.includes('chore(perf): update baselines') ||
        commitMessage.includes('[baseline-update]')) {
        console.log('[CI] ✅ Baseline update via approved process (current commit)');
        process.exit(0);
    }

    // For merge commits or squashed PRs, check all commits that touched baselines
    // Get all commits that modified the baselines file
    const baselineCommits = git(`log --pretty=format:"%H" --follow -- "${baselinesPath}"`);
    if (baselineCommits) {
        const commits = baselineCommits.split('\n').slice(0, 10); // Check last 10
        for (const sha of commits) {
            const msg = git(`log -1 --pretty=%B ${sha}`);
            if (msg.includes('chore(perf): update baselines') ||
                msg.includes('[baseline-update]')) {
                console.log(`[CI] ✅ Found approved baseline update in commit ${sha.substring(0, 7)}`);
                process.exit(0);
            }
        }
    }

    // Check if updatedBy field shows manual script usage (timestamp check)
    if (fs.existsSync(baselinesPath)) {
        const baselines = JSON.parse(fs.readFileSync(baselinesPath, 'utf-8'));
        if (baselines.updated) {
            const recentUpdate = new Date(baselines.updated);
            const commitDate = new Date(git('log -1 --format=%cI'));

            // If updated within 5 minutes of commit, likely from script
            const timeDiff = Math.abs(commitDate - recentUpdate);
            if (timeDiff < 5 * 60 * 1000) {
                console.log('[CI] ✅ Baseline timestamp matches commit (likely via script)');
                process.exit(0);
            }
        }
    }

    // Fail - direct edit detected
    console.error('[CI] ❌ BLOCKED: Direct edit to perf-baselines.json detected');
    console.error('[CI] Baselines must be updated via: pnpm run perf:update-baseline');
    console.error('[CI] Or use commit message: chore(perf): update baselines [baseline-update]');
    process.exit(1);

} catch (error) {
    console.error('[CI] Error checking baselines:', error.message);
    // Fail safe - reject on error
    process.exit(1);
}
