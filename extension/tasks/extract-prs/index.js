/**
 * Node.js wrapper for ado-git-repo-insights Python CLI.
 *
 * Adjustment 6: Locked Node → Python Execution Contract
 * - Python 3.10+ required
 * - Explicit entrypoint: python -m ado_git_repo_insights.cli
 * - Fail-fast diagnostics if runtime environment invalid
 *
 * Invariant 17: Must run on hosted and self-hosted agents
 * Invariant 18: Clear failures with actionable logs
 * Invariant 19: PAT is never logged
 */

const tl = require('azure-pipelines-task-lib/task');
const { execSync, spawn } = require('child_process');
const path = require('path');

// Adjustment 6: Locked execution contract
const PYTHON_MIN_VERSION = '3.10';
const PACKAGE_NAME = 'ado-git-repo-insights';
const CLI_MODULE = 'ado_git_repo_insights.cli';

/**
 * Validate Python environment meets requirements.
 * Invariant 18: Fail-fast with actionable error message.
 */
async function validatePythonEnvironment() {
    try {
        // Try common Python commands
        const pythonCommands = ['python', 'python3', 'py'];
        let pythonCmd = null;
        let versionInfo = null;

        for (const cmd of pythonCommands) {
            try {
                const output = execSync(`${cmd} --version 2>&1`, { encoding: 'utf-8' });
                const match = output.match(/Python (\d+)\.(\d+)/);
                if (match) {
                    const major = parseInt(match[1], 10);
                    const minor = parseInt(match[2], 10);
                    const version = major + minor / 100;
                    const required = parseFloat(PYTHON_MIN_VERSION);

                    if (version >= required) {
                        pythonCmd = cmd;
                        versionInfo = `${major}.${minor}`;
                        break;
                    }
                }
            } catch (e) {
                // This command not available, try next
                continue;
            }
        }

        if (!pythonCmd) {
            throw new Error(
                `Python ${PYTHON_MIN_VERSION}+ not found.\n` +
                `Tried commands: ${pythonCommands.join(', ')}\n` +
                `Please ensure Python is installed and available in PATH.`
            );
        }

        tl.debug(`Using Python: ${pythonCmd} (version ${versionInfo})`);
        return pythonCmd;

    } catch (err) {
        tl.setResult(tl.TaskResult.Failed,
            `Python environment validation failed:\n${err.message}\n\n` +
            `Resolution:\n` +
            `1. On hosted agents: Use 'UsePythonVersion@0' task before this task\n` +
            `2. On self-hosted agents: Install Python ${PYTHON_MIN_VERSION}+ and add to PATH`
        );
        return null;
    }
}

/**
 * Install the Python package if not already installed.
 */
function installPackage(pythonCmd) {
    try {
        tl.debug(`Checking if ${PACKAGE_NAME} is installed...`);

        // Check if package is already installed
        try {
            execSync(`${pythonCmd} -c "import ado_git_repo_insights"`, {
                encoding: 'utf-8',
                stdio: 'pipe'
            });
            tl.debug(`${PACKAGE_NAME} already installed`);
            return true;
        } catch (e) {
            // Package not installed, install it
            tl.debug(`Installing ${PACKAGE_NAME}...`);
            execSync(`${pythonCmd} -m pip install ${PACKAGE_NAME} --quiet`, {
                stdio: 'inherit'
            });
            return true;
        }
    } catch (err) {
        tl.setResult(tl.TaskResult.Failed,
            `Failed to install ${PACKAGE_NAME}:\n${err.message}\n\n` +
            `Resolution:\n` +
            `1. Check network connectivity\n` +
            `2. Ensure pip is available: ${pythonCmd} -m pip --version`
        );
        return false;
    }
}

/**
 * Main task execution.
 */
async function run() {
    // Invariant 18: Fail-fast on invalid runtime environment
    const pythonCmd = await validatePythonEnvironment();
    if (!pythonCmd) return;

    // Install package
    if (!installPackage(pythonCmd)) return;

    try {
        // Get task inputs
        const organization = tl.getInput('organization', true);
        const projects = tl.getInput('projects', true);
        const pat = tl.getInput('pat', true);
        const startDate = tl.getInput('startDate', false);
        const endDate = tl.getInput('endDate', false);
        const backfillDays = tl.getInput('backfillDays', false);
        const databasePath = tl.getInput('databasePath', false) || 'ado-insights.sqlite';
        const outputDir = tl.getInput('outputDir', false) || 'csv_output';

        // Log configuration (Invariant 19: Never log PAT)
        console.log('='.repeat(50));
        console.log('ADO Git Repo Insights - Configuration');
        console.log('='.repeat(50));
        console.log(`Organization: ${organization}`);
        console.log(`Projects: ${projects.split(/[\n,]/).map(p => p.trim()).filter(Boolean).join(', ')}`);
        console.log(`Database: ${databasePath}`);
        console.log(`Output: ${outputDir}`);
        console.log(`PAT: ********`);  // Invariant 19: Redacted
        if (startDate) console.log(`Start Date: ${startDate}`);
        if (endDate) console.log(`End Date: ${endDate}`);
        if (backfillDays) console.log(`Backfill Days: ${backfillDays}`);
        console.log('='.repeat(50));

        // Build extraction command
        const extractArgs = [
            '-m', CLI_MODULE,
            'extract',
            '--organization', organization,
            '--projects', projects.replace(/\n/g, ','),
            '--pat', pat,
            '--database', databasePath,
        ];

        if (startDate) extractArgs.push('--start-date', startDate);
        if (endDate) extractArgs.push('--end-date', endDate);
        if (backfillDays) extractArgs.push('--backfill-days', backfillDays);

        // Run extraction
        console.log('\n[1/2] Running extraction...');
        const extractResult = await runPython(pythonCmd, extractArgs);
        if (!extractResult) return;

        // Build CSV generation command
        const csvArgs = [
            '-m', CLI_MODULE,
            'generate-csv',
            '--database', databasePath,
            '--output', outputDir,
        ];

        // Run CSV generation
        console.log('\n[2/2] Generating CSVs...');
        const csvResult = await runPython(pythonCmd, csvArgs);
        if (!csvResult) return;

        // Success
        console.log('\n' + '='.repeat(50));
        console.log('Extraction and CSV generation completed successfully!');
        console.log(`Database: ${databasePath}`);
        console.log(`CSVs: ${outputDir}/`);
        console.log('='.repeat(50));

        tl.setResult(tl.TaskResult.Succeeded, 'Extraction completed successfully');

    } catch (err) {
        tl.setResult(tl.TaskResult.Failed, `Task failed: ${err.message}`);
    }
}

/**
 * Run Python command and return success status.
 */
function runPython(pythonCmd, args) {
    return new Promise((resolve) => {
        const proc = spawn(pythonCmd, args, {
            stdio: 'inherit',
            shell: process.platform === 'win32'
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                tl.setResult(tl.TaskResult.Failed,
                    `Python process exited with code ${code}`
                );
                resolve(false);
            } else {
                resolve(true);
            }
        });

        proc.on('error', (err) => {
            tl.setResult(tl.TaskResult.Failed,
                `Failed to spawn Python process: ${err.message}`
            );
            resolve(false);
        });
    });
}

// Execute
run();
