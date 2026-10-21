#!/usr/bin/env node
// Verify packaged SkillScope artifacts and write SHA256SUMS.txt.
//
//   node scripts/verify-release.mjs apps/desktop/release [--smoke]
//
// Checks: expected installers exist; the app.asar contains the bundled main, preload and renderer
// and no node_modules or source maps; security fuses are set; optionally runs the packaged app's
// self-check (SKILLSCOPE_SMOKE_TEST) against an isolated fake home directory.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import asar from '@electron/asar';
import fuses from '@electron/fuses';

const { FuseV1Options, getCurrentFuseWire } = fuses;
// FuseState is a const enum in the typings and is not exported at runtime: '0' / '1' bytes.
const FuseState = { DISABLE: 48, ENABLE: 49 };

let releaseDir = resolve(process.argv[2] ?? '');
// Accept apps/desktop/release and pick the folder for the current app version.
const desktopPkg = JSON.parse(
  await readFile(resolve(import.meta.dirname, '../apps/desktop/package.json'), 'utf8'),
);
if (existsSync(join(releaseDir, desktopPkg.version)))
  releaseDir = join(releaseDir, desktopPkg.version);
const smoke = process.argv.includes('--smoke');
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`✗ ${msg}`);
};
const pass = (msg) => console.log(`✓ ${msg}`);

if (!process.argv[2] || !existsSync(releaseDir)) {
  console.error('usage: node scripts/verify-release.mjs <release-dir> [--smoke]');
  process.exit(2);
}

const entries = await readdir(releaseDir);
const installers = entries.filter((n) => /\.(AppImage|deb|exe)$/.test(n));
const expected =
  process.platform === 'win32'
    ? [/windows-x64-setup\.exe$/]
    : [/linux-x86_64\.AppImage$/, /linux-amd64\.deb$/];
for (const pattern of expected) {
  const found = installers.find((n) => pattern.test(n));
  if (found) pass(`artifact ${found}`);
  else fail(`missing artifact matching ${pattern}`);
}

const unpacked = entries.find((n) => n.endsWith('-unpacked'));
if (!unpacked) fail('no *-unpacked directory');
const unpackedDir = unpacked ? join(releaseDir, unpacked) : '';
const asarPath = join(unpackedDir, 'resources', 'app.asar');
if (unpacked && existsSync(asarPath)) {
  const files = asar.listPackage(asarPath, { isPack: false }).map((f) => f.replace(/\\/g, '/'));
  for (const required of [
    '/out/main/index.js',
    '/out/preload/index.cjs',
    '/out/renderer/index.html',
    '/package.json',
  ]) {
    if (files.includes(required)) pass(`asar contains ${required}`);
    else fail(`asar is missing ${required}`);
  }
  if (files.some((f) => f.includes('/node_modules/')))
    fail('asar contains node_modules (runtime should be fully bundled)');
  else pass('asar contains no node_modules');
  if (files.some((f) => f.endsWith('.map'))) fail('asar contains source maps');
  else pass('asar contains no source maps');
  const pkg = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  if (pkg.name === 'skillscope') pass(`packaged name ${pkg.name}@${pkg.version}`);
  else fail(`unexpected packaged name ${pkg.name}`);
} else if (unpacked) {
  fail('resources/app.asar not found');
}

const exe = unpacked
  ? join(unpackedDir, process.platform === 'win32' ? 'skillscope.exe' : 'skillscope')
  : '';
if (exe && existsSync(exe)) {
  const wire = await getCurrentFuseWire(exe);
  const expectations = [
    [FuseV1Options.RunAsNode, FuseState.DISABLE, 'RunAsNode disabled'],
    [
      FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      FuseState.DISABLE,
      'NODE_OPTIONS disabled',
    ],
    [
      FuseV1Options.EnableNodeCliInspectArguments,
      FuseState.DISABLE,
      'inspector arguments disabled',
    ],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE, 'only loads app from asar'],
  ];
  for (const [fuse, state, label] of expectations) {
    if (wire[fuse] === state) pass(`fuse: ${label}`);
    else fail(`fuse not set: ${label}`);
  }
} else if (unpacked) {
  fail(`executable not found at ${exe}`);
}

if (smoke && exe && existsSync(exe)) {
  const work = await mkdtemp(join(tmpdir(), 'skillscope-smoke-'));
  const home = join(work, 'home');
  await cp(resolve(import.meta.dirname, '../fixtures/home/basic'), home, { recursive: true });
  const report = join(work, 'report.json');
  const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
  const run = spawnSync(exe, args, {
    env: {
      ...process.env,
      SKILLSCOPE_SMOKE_TEST: report,
      SKILLSCOPE_HOME_OVERRIDE: home,
      SKILLSCOPE_DATA_DIR: join(work, 'data'),
      SKILLSCOPE_OFFLINE: '1',
    },
    timeout: 90_000,
    stdio: 'inherit',
  });
  if (existsSync(report)) {
    const result = JSON.parse(await readFile(report, 'utf8'));
    if (result.ok && result.uniqueSkills === 7)
      pass(`packaged app self-check: ${JSON.stringify(result)}`);
    else fail(`packaged app self-check failed: ${JSON.stringify(result)}`);
  } else {
    fail(
      `packaged app produced no smoke report (exit ${run.status}, ${run.error?.message ?? 'no error'})`,
    );
  }
  await rm(work, { recursive: true, force: true });
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const sums = [];
for (const name of installers.sort())
  sums.push(`${await sha256(join(releaseDir, name))}  ${basename(name)}`);
await writeFile(join(releaseDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
pass(`wrote SHA256SUMS.txt (${sums.length} files)`);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll release checks passed');
