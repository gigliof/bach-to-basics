import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const { version } = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const release = path.join(root, 'release', version);
const signed = process.argv.includes('--signed');
const app = path.join(release, signed ? 'distribution' : 'Bach to Basics-darwin-arm64', 'Bach to Basics.app');
if (!fs.existsSync(app)) throw new Error('Build the macOS app first.');
// This command packages the existing local build; it does not sign or notarize.
const output = path.join(release, `Bach to Basics-${version}-macOS-arm64${signed ? '' : '-unnotarized'}.dmg`);
const stage = fs.mkdtempSync(path.join(here, '.dmg-stage-'));
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
try {
  run('ditto', [app, path.join(stage, 'Bach to Basics.app')]);
  fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
  fs.writeFileSync(path.join(stage, 'Install Bach to Basics.txt'), `Bach to Basics ${version}\n\nDrag Bach to Basics.app onto Applications. Then open Bach to Basics from Applications.\n\nRequires an Apple Silicon Mac (M1 or later) running macOS 26 or later.\n\n${signed ? 'Developer ID distribution build.' : 'This preview is locally signed, not Developer ID signed or Apple-notarized. It may be blocked by Gatekeeper. A public release should be signed and notarized before sharing widely.'}\n`);
  run('hdiutil', ['create', '-volname', 'Bach to Basics', '-srcfolder', stage, '-ov', '-format', 'UDZO', '-fs', 'HFS+', output]);
  run('hdiutil', ['verify', output]);
  console.log(`Created: ${output}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
