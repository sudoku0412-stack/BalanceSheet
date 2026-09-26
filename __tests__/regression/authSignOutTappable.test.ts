/**
 * Regression: after Sign out the login screen painted but no control
 * responded. A second router.replace('/auth') mid native-stack transition
 * plus GIDSignIn/RevenueCat on the main thread left the screen frozen.
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Regression: sign-out leaves the login screen tappable', () => {
  it('remounts the stack on session flip and does not freeze blurred screens', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(source).toMatch(/key=\{signedIn \? 'in' : 'out'\}/);
    expect(source).toMatch(/freezeOnBlur:\s*false/);
    expect(source).toMatch(/animation:\s*'none'/);
    expect(source).toMatch(/segmentsRef/);
    const scheduler = fs.readFileSync(
      path.join(__dirname, '../../lib/scheduleRouteReplace.ts'),
      'utf8',
    );
    expect(scheduler).toMatch(/isComplete\?\.\(\)/);
  });

  it('defers native Google/Firebase/RevenueCat sign-out until after /auth is showing', () => {
    const authCtx = fs.readFileSync(path.join(__dirname, '../../lib/AuthContext.tsx'), 'utf8');
    const entitlements = fs.readFileSync(
      path.join(__dirname, '../../lib/EntitlementsContext.tsx'),
      'utf8',
    );
    expect(authCtx).toMatch(/NATIVE_SIGNOUT_DEFER_MS/);
    expect(entitlements).toMatch(/NATIVE_SIGNOUT_DEFER_MS/);
  });
});
