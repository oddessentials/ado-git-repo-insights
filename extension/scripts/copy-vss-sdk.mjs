/**
 * copy-vss-sdk.mjs - Cross-platform VSS SDK copy with line ending normalization
 *
 * Copies vss-web-extension-sdk from node_modules to ui/ with CRLF→LF conversion.
 * Uses Node.js for guaranteed cross-platform behavior (Windows, Linux, macOS).
 *
 * Usage: node scripts/copy-vss-sdk.mjs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.dirname(__dirname);

const srcPath = path.join(extensionDir, 'node_modules', 'vss-web-extension-sdk', 'lib', 'VSS.SDK.min.js');
const dstPath = path.join(extensionDir, 'ui', 'VSS.SDK.min.js');

function main() {
    // Check if source exists
    if (!fs.existsSync(srcPath)) {
        console.log('ℹ VSS SDK source not found at', srcPath, '- skipping');
        console.log('  This is expected on first clone before npm install');
        process.exit(0);
    }

    // Read file content
    let content = fs.readFileSync(srcPath, 'utf8');

    // Normalize line endings: CRLF → LF
    content = content.replace(/\r\n/g, '\n');

    // Normalize line endings: any remaining CR → LF (old Mac format)
    content = content.replace(/\r/g, '\n');

    // Ensure single trailing newline
    content = content.trimEnd() + '\n';

    // Write to destination
    fs.writeFileSync(dstPath, content, 'utf8');

    console.log('✓ Copied VSS.SDK.min.js to ui/');
    console.log('  - CRLF normalized to LF');
    console.log('  - Trailing newline ensured');
}

main();
