/**
 * Stage Task Dependencies for VSIX Packaging
 *
 * Installs production dependencies into each Azure DevOps task folder.
 * This is required because VSIX packaging just copies files - it doesn't
 * run npm install.
 *
 * Usage: node scripts/stage-task-deps.mjs
 * Called by: npm run package:vsix
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.resolve(__dirname, '../tasks');

// Tasks to skip (not actual pipeline tasks)
const SKIP_DIRS = ['_shared'];

async function stageTaskDeps() {
    console.log('📦 Staging task dependencies for VSIX packaging...\n');

    const taskDirs = fs.readdirSync(tasksDir).filter((dir) => {
        const fullPath = path.join(tasksDir, dir);
        return (
            fs.statSync(fullPath).isDirectory() &&
            !SKIP_DIRS.includes(dir) &&
            fs.existsSync(path.join(fullPath, 'package.json'))
        );
    });

    if (taskDirs.length === 0) {
        console.log('⚠ No task directories with package.json found');
        return;
    }

    for (const taskDir of taskDirs) {
        const taskPath = path.join(tasksDir, taskDir);
        const packageJsonPath = path.join(taskPath, 'package.json');
        const lockfilePath = path.join(taskPath, 'package-lock.json');

        console.log(`📁 ${taskDir}/`);

        // Use npm ci if lockfile exists (deterministic), otherwise npm install
        const hasLockfile = fs.existsSync(lockfilePath);
        const npmCmd = hasLockfile ? 'npm ci --production' : 'npm install --production';

        try {
            console.log(`   Running: ${npmCmd}`);
            execSync(npmCmd, {
                cwd: taskPath,
                stdio: ['pipe', 'pipe', 'pipe'],
                encoding: 'utf-8',
            });

            // Verify critical dependency installed
            const nodeModulesPath = path.join(taskPath, 'node_modules');
            const taskLibPath = path.join(
                nodeModulesPath,
                'azure-pipelines-task-lib'
            );

            if (fs.existsSync(taskLibPath)) {
                const depCount = fs.readdirSync(nodeModulesPath).length;
                console.log(`   ✓ Staged ${depCount} packages\n`);
            } else {
                console.error(
                    `   ✗ CRITICAL: azure-pipelines-task-lib not found!`
                );
                process.exit(1);
            }
        } catch (err) {
            console.error(`   ✗ Failed to install dependencies: ${err.message}`);
            process.exit(1);
        }
    }

    console.log('✅ All task dependencies staged successfully!');
    console.log('   Run: npx tfx-cli extension create --manifest-globs vss-extension.json');
}

stageTaskDeps().catch((err) => {
    console.error('Staging failed:', err);
    process.exit(1);
});
