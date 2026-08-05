/**
 * Regression test — "fix(pdf): detect expo-print via require, not the
 * legacy NativeModules" (lib/pdfExport.ts, commit 1ae6271).
 *
 * Original failure mode: PDF-export availability was probed via
 * `NativeModules.ExpoPrint` (and a couple of legacy sibling keys).
 * expo-print ships on the new Expo Modules API
 * (`requireNativeModule`), which never registers itself on RN's
 * `NativeModules` global — so that probe was always falsy, even on a
 * build where expo-print WAS actually linked and working. Reports'
 * export button silently fell back to CSV on every build.
 *
 * Fixed by dropping the NativeModules probe entirely and instead lazy-
 * `require('expo-print')` inside a try/catch: the require throws when
 * the native side isn't linked (unavailable -> null, falls back to
 * CSV), and succeeds and is cached when it is linked (available).
 *
 * This test simulates exactly the scenario that broke the old check:
 * `NativeModules.ExpoPrint` reports falsy/absent, but `require('expo-print')`
 * resolves fine (i.e. the module IS actually linked). Asserts
 * isPdfExportAvailable() is true — the old NativeModules-based
 * implementation would have wrongly returned false here. Also checks
 * the require-throws case still correctly reports unavailable.
 */

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    // Simulate the exact regression scenario: no ExpoPrint (or any
    // legacy sibling key) registered on NativeModules, even though the
    // module is actually linked and requirable.
    NativeModules: { ...actual.NativeModules, ExpoPrint: undefined, ExponentPrint: undefined, RNPrint: undefined },
  };
});

describe('Regression: PDF export availability detection (lib/pdfExport.ts)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('reports available when require("expo-print") succeeds, even though NativeModules has no ExpoPrint entry', () => {
    jest.doMock('expo-print', () => ({
      printToFileAsync: jest.fn(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const { isPdfExportAvailable } = require('../../lib/pdfExport');
    expect(isPdfExportAvailable()).toBe(true);
  });

  it('reports unavailable when require("expo-print") throws (native side not linked)', () => {
    jest.doMock('expo-print', () => {
      throw new Error('Cannot find native module ExpoPrint');
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const { isPdfExportAvailable } = require('../../lib/pdfExport');
    expect(isPdfExportAvailable()).toBe(false);
  });

  it('does not import/reference react-native NativeModules for detection', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../lib/pdfExport.ts'),
      'utf8',
    );
    // The doc comment at the top of the file is allowed to mention
    // NativeModules as history context — what must never come back is
    // an actual line of CODE (not a `//`/`*` comment line) referencing
    // it, which is what the original buggy detection used.
    const codeLines = source
      .split('\n')
      .filter((line: string) => !/^\s*(\/\/|\*|\/\*)/.test(line));
    const codeSource = codeLines.join('\n');

    expect(codeSource).not.toMatch(/NativeModules/);
    expect(source).toMatch(/require\(['"]expo-print['"]\)/);
  });
});
