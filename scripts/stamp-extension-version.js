/**
 * Version stamping script for ADO extension release automation.
 *
 * Updates version in:
 * - VERSION (plain text for run_summary.py)
 * - extension/vss-extension.json (string: "X.Y.Z")
 * - extension/tasks/extract-prs/task.json (object: {Major, Minor, Patch})
 *
 * VERSIONING POLICY:
 * - Extension version (vss-extension.json): Follows semantic-release (X.Y.Z)
 * - Task version (task.json): Major is PRESERVED unless BREAKING TASK CHANGE
 *   - Task Major changes ONLY for breaking contract changes (inputs/outputs/behavior)
 *   - Task Minor/Patch follow extension Minor/Patch
 *
 * Called by semantic-release via @semantic-release/exec:
 *   node scripts/stamp-extension-version.js ${nextRelease.version}
 */

const fs = require('fs');
const path = require('path');

const VERSION_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;

// Paths relative to this script
const PATHS = {
    vss: path.join(__dirname, '../extension/vss-extension.json'),
    task: path.join(__dirname, '../extension/tasks/extract-prs/task.json'),
    version: path.join(__dirname, '../VERSION'),
};

/**
 * Validate version string format
 */
function parseVersion(version) {
    if (!version) {
        console.error('ERROR: Version argument required');
        console.error('Usage: node stamp-extension-version.js <version>');
        process.exit(1);
    }

    const match = version.match(VERSION_REGEX);
    if (!match) {
        console.error(`ERROR: Invalid version format "${version}"`);
        console.error('Expected semantic version format: X.Y.Z (e.g., 1.2.3)');
        process.exit(1);
    }

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    const patch = parseInt(match[3], 10);

    // Fail fast on NaN
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
        console.error(`ERROR: Version components parsed as NaN: ${major}.${minor}.${patch}`);
        process.exit(1);
    }

    if (major < 0 || minor < 0 || patch < 0) {
        console.error(`ERROR: Version components must be non-negative: ${major}.${minor}.${patch}`);
        process.exit(1);
    }

    return { major, minor, patch };
}

/**
 * Validate vss-extension.json schema (version must be string)
 */
function validateVssSchema(vss) {
    if (typeof vss.version !== 'string' && vss.version !== undefined) {
        console.error('ERROR: vss-extension.json version must be a string');
        console.error(`Found: ${JSON.stringify(vss.version)}`);
        process.exit(1);
    }
}

/**
 * Validate task.json schema (version must be object with Major, Minor, Patch)
 */
function validateTaskSchema(task) {
    const v = task.version;
    if (!v || typeof v !== 'object') {
        console.error('ERROR: task.json version must be an object');
        console.error(`Found: ${JSON.stringify(v)}`);
        process.exit(1);
    }

    if (typeof v.Major !== 'number' || typeof v.Minor !== 'number' || typeof v.Patch !== 'number') {
        console.error('ERROR: task.json version must have numeric Major, Minor, Patch');
        console.error(`Found: ${JSON.stringify(v)}`);
        process.exit(1);
    }
}

/**
 * Read and parse JSON file with error handling
 */
function readJson(filePath, desc) {
    if (!fs.existsSync(filePath)) {
        console.error(`ERROR: ${desc} not found at ${filePath}`);
        process.exit(1);
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`ERROR: Failed to parse ${desc}: ${e.message}`);
        process.exit(1);
    }
}

/**
 * Write JSON file with consistent formatting
 */
function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n');
}

function main() {
    const version = process.argv[2];
    const { major, minor, patch } = parseVersion(version);

    console.log(`Stamping extension version: ${version}`);

    // === Update vss-extension.json (string version) ===
    const vss = readJson(PATHS.vss, 'vss-extension.json');
    validateVssSchema(vss);
    vss.version = version;
    writeJson(PATHS.vss, vss);
    console.log(`✓ Updated vss-extension.json to ${version}`);

    // === Update task.json (object version, PRESERVE Major) ===
    const task = readJson(PATHS.task, 'task.json');
    validateTaskSchema(task);

    const currentTaskMajor = task.version.Major;

    // POLICY: Task Major is preserved, only Minor/Patch updated
    task.version = {
        Major: currentTaskMajor,
        Minor: minor,
        Patch: patch
    };
    writeJson(PATHS.task, task);
    console.log(`✓ Updated task.json to ${currentTaskMajor}.${minor}.${patch} (Major preserved)`);

    // === Update VERSION file ===
    fs.writeFileSync(PATHS.version, version + '\n');
    console.log(`✓ Updated VERSION to ${version}`);

    console.log('Version stamping complete.');
}

main();
