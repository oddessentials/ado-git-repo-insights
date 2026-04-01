/**
 * Package a dev VSIX with an auto-generated unique version.
 *
 * Uses a timestamp-based version (99.0.<unix_seconds>) so each build
 * produces a version the marketplace will accept without manual bumping.
 * The 99.x.x prefix is always higher than any production release.
 *
 * Applies dev-overrides.json for name and gallery flags, then layers
 * a dynamic version via --override. No tracked files are modified.
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
    + ' --manifest-globs vss-extension.json'
    + ' --overrides-file dev-overrides.json'
    + ' --override ' + JSON.stringify(override),
    { stdio: 'inherit', shell: true },
);
