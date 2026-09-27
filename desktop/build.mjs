import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: root, stdio: 'inherit', ...options });
const stage = path.join(here, 'staging');
fs.mkdirSync(stage, { recursive: true });
if (!process.argv.includes('--package-only')) {
run('pnpm', ['--filter', 'frontend', 'build'], { env: { ...process.env, DESKTOP_BUILD: '1' } });
run(path.join(here, '.venv/bin/python'), [
  '-m', 'PyInstaller', '--noconfirm', '--clean', '--name', 'bach-backend',
  '--distpath', path.join(here, 'python-dist'), '--workpath', path.join(here, 'python-build'),
  '--specpath', here, '--paths', path.join(root, 'backend'),
  '--collect-submodules', 'services', '--collect-submodules', 'pianoplayer',
  '--collect-all', 'music21', '--collect-data', 'certifi',
  '--exclude-module', 'matplotlib', '--exclude-module', 'tkinter', '--exclude-module', 'IPython',
  path.join(here, 'backend_entry.py'),
], { env: { ...process.env, PYINSTALLER_CONFIG_DIR: path.join(here, '.pyinstaller-cache') } });
fs.rmSync(path.join(stage, 'backend'), { recursive: true, force: true });
fs.cpSync(path.join(here, 'python-dist/bach-backend'), path.join(stage, 'backend'), { recursive: true, verbatimSymlinks: true });
fs.rmSync(path.join(stage, 'frontend'), { recursive: true, force: true });
fs.cpSync(path.join(root, 'frontend/dist'), path.join(stage, 'frontend'), { recursive: true });
}
for (const file of ['LICENSE', 'NOTICE']) fs.copyFileSync(path.join(root, file), path.join(stage, file));
fs.copyFileSync(path.join(here, 'MAC-APP.md'), path.join(stage, 'MAC-APP.md'));

const iconset = path.join(here, 'AppIcon.iconset');
fs.mkdirSync(iconset, { recursive: true });
run('swift', ['-module-cache-path', path.join(here, '.swift-cache'), path.join(here, 'icon.swift'), path.join(here, 'AppIcon.png')]);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    run('sips', ['-z', String(size * scale), String(size * scale), path.join(here, 'AppIcon.png'), '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
}
run('iconutil', ['-c', 'icns', iconset, '-o', path.join(here, 'AppIcon.icns')]);
const appDir = path.join(here, 'app-source');
fs.mkdirSync(appDir, { recursive: true });
for (const file of ['main.cjs', 'preload.cjs', 'smoke.cjs']) fs.copyFileSync(path.join(here, file), path.join(appDir, file));
const metadata = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
delete metadata.devDependencies; delete metadata.scripts;
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(metadata, null, 2));
const apps = await packager({
  dir: appDir, out: path.join(root, 'release', metadata.version), name: 'Bach to Basics',
  executableName: 'Bach to Basics', appBundleId: 'app.bachtobasics.desktop',
  appVersion: metadata.version, buildVersion: '1', platform: 'darwin', arch: process.arch,
  electronVersion: '44.4.5', overwrite: true, asar: true,
  icon: path.join(here, 'AppIcon.icns'),
  extraResource: ['frontend', 'MAC-APP.md', 'LICENSE', 'NOTICE'].map((name) => path.join(stage, name)),
  extendInfo: {
    LSMinimumSystemVersion: '26.0',
    CFBundleDisplayName: 'Bach to Basics', NSHighResolutionCapable: true,
    CFBundleDocumentTypes: [{ CFBundleTypeName: 'Piano music', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', CFBundleTypeExtensions: ['mid', 'midi', 'xml', 'musicxml', 'mxl'] }],
  },
});
for (const folder of apps) {
  const bundle = path.join(folder, 'Bach to Basics.app');
  // Preserve relative framework/dylib links; packager's resource copy turns
  // these into absolute links to the build machine, breaking portability.
  fs.cpSync(path.join(stage, 'backend'), path.join(bundle, 'Contents/Resources/backend'), { recursive: true, verbatimSymlinks: true });
  run('codesign', ['--force', '--deep', '--sign', '-', bundle]);
  run('codesign', ['--verify', '--deep', '--strict', bundle]);
  console.log(`Built app: ${bundle}`);
}
