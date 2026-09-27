import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sign } from '@electron/osx-sign';
const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const release = path.resolve(here, '../release', version);
const source = path.join(release, 'Bach to Basics-darwin-arm64/Bach to Basics.app');
const destination = path.join(release, 'distribution');
const app = path.join(destination, 'Bach to Basics.app');
const identity = process.env.BACH_SIGN_IDENTITY;
if (!identity) throw new Error('Set BACH_SIGN_IDENTITY to a Developer ID Application identity.');
fs.mkdirSync(destination, { recursive: true });
if (fs.existsSync(app)) throw new Error('Distribution app already exists; inspect before replacing it.');
execFileSync('ditto', [source, app]);
const guide = path.join(app, 'Contents/Resources/MAC-APP.md');
fs.writeFileSync(guide, fs.readFileSync(guide, 'utf8').replace('and is locally ad-hoc signed. It is not Developer ID signed or notarized for public distribution.', 'and is signed with Developer ID. Distribute only after Apple notarization has been accepted.'));
await sign({
  app, identity, platform: 'darwin', type: 'distribution', preAutoEntitlements: false,
  ignore: [file => {
    if (!fs.statSync(file).isFile()) return false;
    const fd = fs.openSync(file, 'r');
    const magic = Buffer.alloc(4);
    try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
    return !['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(magic.toString('hex'));
  }],
  optionsForFile: file => file.includes('/Resources/backend/') ? { entitlements: [], hardenedRuntime: true } : { hardenedRuntime: true },
});
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
console.log(`Signed: ${app}`);
