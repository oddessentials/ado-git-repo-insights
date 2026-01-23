/**
 * Clean Task Dependencies
 *
 * Removes node_modules from task folders to restore clean dev state.
 * Use after building VSIX or to reset task folders.
 *
 * Usage: node scripts/clean-task-deps.mjs
 * Called by: npm run clean:tasks
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.resolve(__dirname, '../tasks');

// Tasks to skip (not actual pipeline tasks)
const SKIP_DIRS = ['_shared'];

function cleanTaskDeps() {
    console.log('🧹 Cleaning task dependencies...\n');

    const taskDirs = fs.readdirSync(tasksDir).filter((dir) => {
        const fullPath = path.join(tasksDir, dir);
        return fs.statSync(fullPath).isDirectory() && !SKIP_DIRS.includes(dir);
    });

    let cleaned = 0;

    for (const taskDir of taskDirs) {
        const nodeModulesPath = path.join(tasksDir, taskDir, 'node_modules');

        if (fs.existsSync(nodeModulesPath)) {
            console.log(`   Removing: ${taskDir}/node_modules/`);
            fs.rmSync(nodeModulesPath, { recursive: true, force: true });
            cleaned++;
        }
    }

    if (cleaned === 0) {
        console.log('   Nothing to clean.');
    } else {
        console.log(`\n✅ Cleaned ${cleaned} task node_modules folder(s).`);
    }
}

cleanTaskDeps();
