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
 *   node scripts/stamp-extension-version.cjs ${nextRelease.version}
 *
 * Options:
 *   --dry-run  Validate files exist and version format, but don't modify anything
 */

const fs = require('fs');
const path = require('path');

const VERSION_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;

// Resolve paths from project root (where semantic-release runs)
const projectRoot = process.cwd();
const PATHS = {
    vss: path.resolve(projectRoot, 'extension/vss-extension.json'),
    task: path.resolve(projectRoot, 'extension/tasks/extract-prs/task.json'),
    version: path.resolve(projectRoot, 'VERSION'),
};

/**
 * Parse and validate version string
 */
function parseVersion(version) {
    if (!version) {
        console.error('ERROR: Version argument required');
        console.error('Usage: node stamp-extension-version.cjs <version> [--dry-run]');
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
 * Validate all required files exist
 */
function validateFilesExist() {
    const missing = [];
    for (const [name, filePath] of Object.entries(PATHS)) {
        if (!fs.existsSync(filePath)) {
            missing.push(`${name}: ${filePath}`);
        }
    }

    if (missing.length > 0) {
        console.error('ERROR: Required files not found:');
        missing.forEach(m => console.error(`  - ${m}`));
        console.error(`\nProject root: ${projectRoot}`);
        console.error('Ensure you are running from the repository root directory.');
        process.exit(1);
    }
}

/**
 * Read and parse JSON file
 */
function readJson(filePath, desc) {
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

/**
 * Main entry point
 */
function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const version = args.find(a => !a.startsWith('--'));

    const { major, minor, patch } = parseVersion(version);
    const versionString = `${major}.${minor}.${patch}`;

    console.log(`Stamping extension version: ${versionString}${dryRun ? ' (DRY RUN)' : ''}`);
    console.log(`Project root: ${projectRoot}`);

    // Validate all files exist before any modifications
    validateFilesExist();
    console.log('✓ All target files found');

    if (dryRun) {
        // Dry run: just validate, don't modify
        const vss = readJson(PATHS.vss, 'vss-extension.json');
        const task = readJson(PATHS.task, 'task.json');

        console.log(`✓ vss-extension.json current version: ${vss.version}`);
        console.log(`✓ task.json current version: ${task.version.Major}.${task.version.Minor}.${task.version.Patch}`);
        console.log('✓ Dry run complete - no files modified');
        return;
    }

    // === Update vss-extension.json (string version) ===
    const vss = readJson(PATHS.vss, 'vss-extension.json');
    if (typeof vss.version !== 'string' && vss.version !== undefined) {
        console.error('ERROR: vss-extension.json version must be a string');
        process.exit(1);
    }
    vss.version = versionString;
    writeJson(PATHS.vss, vss);
    console.log(`✓ Updated vss-extension.json to ${versionString}`);

    // === Update task.json (object version, PRESERVE Major) ===
    const task = readJson(PATHS.task, 'task.json');
    if (!task.version || typeof task.version !== 'object') {
        console.error('ERROR: task.json version must be an object');
        process.exit(1);
    }

    const currentTaskMajor = task.version.Major;
    task.version = {
        Major: currentTaskMajor,
        Minor: minor,
        Patch: patch
    };
    writeJson(PATHS.task, task);
    console.log(`✓ Updated task.json to ${currentTaskMajor}.${minor}.${patch} (Major preserved)`);

    // === Update VERSION file ===
    fs.writeFileSync(PATHS.version, versionString + '\n');
    console.log(`✓ Updated VERSION to ${versionString}`);

    console.log('Version stamping complete.');
}

main();
