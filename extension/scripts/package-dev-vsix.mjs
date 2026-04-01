/**
 * Package a dev VSIX with an auto-generated unique version.
 *
 * Uses a timestamp-based version (99.0.<unix_seconds>) so each build
 * produces a version the marketplace will accept without manual bumping.
 *
 * Builds from vss-extension-dev.json — a standalone dev manifest with
 * publisher OddEssentials-Dev and extension ID ado-git-repo-insights-dev.
 * This ensures dev builds never pollute the production marketplace listing.
 *
 * Usage: node scripts/package-dev-vsix.mjs
 * Called by: pnpm run package:vsix:dev
 */

import { execSync } from 'child_process';

const version = `99.0.${Math.floor(Date.now() / 1000)}`;
const override = JSON.stringify({ version });

console.log(`\n📦 Dev VSIX version: ${version}\n`);

execSync(
    'pnpm exec tfx extension create'
    + ' --manifest-globs vss-extension-dev.json'
    + ' --override ' + JSON.stringify(override),
    { stdio: 'inherit', shell: true },
);
