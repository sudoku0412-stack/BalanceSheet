#!/usr/bin/env node
/**
 * Bundle-size regression guard.
 *
 * Runs a real Expo/Metro production export for Android, measures the
 * resulting Hermes JS bundle (.hbc) in bytes, and compares it against a
 * recorded baseline. Fails (exit 1) if the bundle grew by more than the
 * allowed threshold, so a dependency bump or an accidentally-bundled
 * asset gets caught in CI instead of shipping silently.
 *
 * Usage:
 *   node scripts/check-bundle-size.js          # compare against baseline
 *   node scripts/check-bundle-size.js --update # (re)record the baseline
 *
 * First run (no baseline file yet) always establishes the baseline and
 * exits 0 — there's nothing to regress against yet.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'bundle-size-baseline.json');
const PLATFORM = 'android';
// Fail the build if the new bundle is more than this fraction larger
// than the recorded baseline. Generous enough to not flake on routine
// dependency bumps, tight enough to catch an accidental duplicate-bundle
// / unminified-build regression.
const REGRESSION_THRESHOLD = 0.10;

function humanBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB (${bytes.toLocaleString()} bytes)`;
}

function runExport(outputDir) {
  execFileSync(
    'npx',
    ['expo', 'export', '--platform', PLATFORM, '--output-dir', outputDir],
    {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function findBundleSize(outputDir) {
  const metadataPath = path.join(outputDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`expo export did not produce ${metadataPath}`);
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const bundleRelPath = metadata?.fileMetadata?.[PLATFORM]?.bundle;
  if (!bundleRelPath) {
    throw new Error(
      `metadata.json has no fileMetadata.${PLATFORM}.bundle entry — ` +
        'expo export output format may have changed.',
    );
  }
  const bundlePath = path.join(outputDir, bundleRelPath);
  const { size } = fs.statSync(bundlePath);
  return { size, bundleRelPath };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function saveBaseline(entry) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(entry, null, 2) + '\n', 'utf8');
}

function main() {
  const shouldUpdate = process.argv.includes('--update');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-size-'));

  console.log(`Running "expo export --platform ${PLATFORM}" (this can take a minute)...`);
  try {
    runExport(tmpDir);
  } catch (err) {
    console.error('expo export failed:');
    console.error(err.stdout ? err.stdout.toString() : err.message);
    console.error(err.stderr ? err.stderr.toString() : '');
    process.exitCode = 1;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return;
  }

  let size, bundleRelPath;
  try {
    ({ size, bundleRelPath } = findBundleSize(tmpDir));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const baseline = loadBaseline();

  console.log('');
  console.log('Bundle size report');
  console.log('-------------------');
  console.log(`Platform:     ${PLATFORM}`);
  console.log(`Bundle file:  ${bundleRelPath}`);
  console.log(`Current size: ${humanBytes(size)}`);

  if (!baseline || shouldUpdate) {
    saveBaseline({
      platform: PLATFORM,
      sizeBytes: size,
      recordedAt: new Date().toISOString(),
    });
    console.log(
      baseline
        ? `Baseline:     updated to ${humanBytes(size)} (--update)`
        : `Baseline:     none found — recorded ${humanBytes(size)} as the new baseline`,
    );
    console.log('Result:       PASS (baseline established)');
    process.exitCode = 0;
    return;
  }

  const delta = size - baseline.sizeBytes;
  const deltaPct = baseline.sizeBytes > 0 ? delta / baseline.sizeBytes : 0;
  const sign = delta >= 0 ? '+' : '';

  console.log(`Baseline:     ${humanBytes(baseline.sizeBytes)} (recorded ${baseline.recordedAt})`);
  console.log(`Delta:        ${sign}${humanBytes(delta)} (${sign}${(deltaPct * 100).toFixed(2)}%)`);
  console.log(`Threshold:    +${(REGRESSION_THRESHOLD * 100).toFixed(0)}%`);

  if (deltaPct > REGRESSION_THRESHOLD) {
    console.log(
      `Result:       FAIL — bundle grew by ${(deltaPct * 100).toFixed(2)}%, ` +
        `exceeding the ${(REGRESSION_THRESHOLD * 100).toFixed(0)}% threshold.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('Result:       PASS');
  process.exitCode = 0;
}

main();
