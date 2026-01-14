/**
 * Version stamping script for ADO extension release automation.
 *
 * Updates version in:
 * - extension/vss-extension.json (string: "X.Y.Z")
 * - extension/tasks/extract-prs/task.json (object: {Major, Minor, Patch})
 *
 * Called by semantic-release via @semantic-release/exec:
 *   node scripts/stamp-extension-version.js ${nextRelease.version}
 */

const fs = require('fs');
const path = require('path');

const VERSION_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;

function main() {
    const version = process.argv[2];

    // Defensive guard: version must be provided
    if (!version) {
        console.error('ERROR: Version argument required');
        console.error('Usage: node stamp-extension-version.js <version>');
        process.exit(1);
    }

    // Defensive guard: version must be valid X.Y.Z format
    const match = version.match(VERSION_REGEX);
    if (!match) {
        console.error(`ERROR: Invalid version format "${version}"`);
        console.error('Expected semantic version format: X.Y.Z (e.g., 1.2.3)');
        process.exit(1);
    }

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    const patch = parseInt(match[3], 10);

    // Defensive guard: parsed values must be valid numbers
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
        console.error(`ERROR: Version components are not valid numbers: ${major}.${minor}.${patch}`);
        process.exit(1);
    }

    // Defensive guard: version components must be non-negative
    if (major < 0 || minor < 0 || patch < 0) {
        console.error(`ERROR: Version components must be non-negative: ${major}.${minor}.${patch}`);
        process.exit(1);
    }

    console.log(`Stamping extension version: ${version}`);

    // Update vss-extension.json (string version)
    const vssPath = path.join(__dirname, '../extension/vss-extension.json');
    if (!fs.existsSync(vssPath)) {
        console.error(`ERROR: vss-extension.json not found at ${vssPath}`);
        process.exit(1);
    }
    const vss = JSON.parse(fs.readFileSync(vssPath, 'utf8'));
    vss.version = version;
    fs.writeFileSync(vssPath, JSON.stringify(vss, null, 4) + '\n');
    console.log(`✓ Updated vss-extension.json to ${version}`);

    // Update task.json (object version)
    const taskPath = path.join(__dirname, '../extension/tasks/extract-prs/task.json');
    if (!fs.existsSync(taskPath)) {
        console.error(`ERROR: task.json not found at ${taskPath}`);
        process.exit(1);
    }
    const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    task.version = {
        Major: major,
        Minor: minor,
        Patch: patch
    };
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 4) + '\n');
    console.log(`✓ Updated task.json to ${major}.${minor}.${patch}`);

    console.log('Version stamping complete.');
}

main();
