/**
 * CI Guard: Validate task.json inputs match index.js usage.
 *
 * Prevents silent misconfiguration where index.js reads input names
 * that don't exist in task.json (causing silent fallback to defaults).
 *
 * Run: npx ts-node scripts/validate-task-inputs.ts
 * Exit 0 = all inputs valid
 * Exit 1 = mismatch detected
 */

import * as fs from 'fs';
import * as path from 'path';

interface TaskInput {
    name: string;
    [key: string]: unknown;
}

interface TaskJson {
    inputs: TaskInput[];
    [key: string]: unknown;
}

const TASK_JSON_PATH = path.join(__dirname, '../extension/tasks/extract-prs/task.json');
const INDEX_JS_PATH = path.join(__dirname, '../extension/tasks/extract-prs/index.js');

function main(): void {
    console.log('Validating task input name consistency...\n');

    // Parse task.json to get defined input names
    const taskJson: TaskJson = JSON.parse(fs.readFileSync(TASK_JSON_PATH, 'utf8'));
    const definedInputs = new Set(taskJson.inputs.map(i => i.name));

    console.log('Inputs defined in task.json:');
    definedInputs.forEach(name => console.log(`  - ${name}`));
    console.log('');

    // Scan index.js for tl.getInput() calls
    const indexJs = fs.readFileSync(INDEX_JS_PATH, 'utf8');

    // Match tl.getInput('inputName', ...) patterns
    // Handles both single and double quotes
    const getInputPattern = /tl\.getInput\s*\(\s*['"]([^'"]+)['"]/g;

    const usedInputs = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = getInputPattern.exec(indexJs)) !== null) {
        usedInputs.add(match[1]!);
    }

    console.log('Inputs used in index.js:');
    usedInputs.forEach(name => console.log(`  - ${name}`));
    console.log('');

    // Find mismatches
    const unknownInputs = [...usedInputs].filter(name => !definedInputs.has(name));
    const unusedInputs = [...definedInputs].filter(name => !usedInputs.has(name));

    let hasErrors = false;

    if (unknownInputs.length > 0) {
        console.error('ERROR: index.js uses inputs NOT defined in task.json:');
        unknownInputs.forEach(name => console.error(`  - "${name}" (used in index.js but not in task.json)`));
        console.error('');
        console.error('This will cause silent misconfiguration - pipeline values ignored!');
        console.error('Fix: Update index.js to use the correct input name from task.json.');
        hasErrors = true;
    }

    if (unusedInputs.length > 0) {
        console.warn('WARNING: task.json defines inputs NOT used in index.js:');
        unusedInputs.forEach(name => console.warn(`  - "${name}" (defined but never read)`));
        console.warn('');
        console.warn('This may indicate dead configuration or missing functionality.');
    }

    if (hasErrors) {
        console.error('\n❌ Validation FAILED');
        process.exit(1);
    }

    console.log('✓ All input names match between task.json and index.js');
    process.exit(0);
}

main();
