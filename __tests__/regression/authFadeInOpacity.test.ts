/**
 * Regression: after Sign out the auth screen landed with password, Log In,
 * and Google occupying space but invisible. FadeInUp used native-driver
 * opacity from 0; the stack replace interrupted those animations and
 * native opacity stayed at 0 (email often completed; later delays did not).
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Regression: auth FadeInUp never animates opacity', () => {
  it('does not bind opacity to the entrance Animated.Value', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app/auth.tsx'), 'utf8');
    expect(source).toMatch(/function FadeInUp/);
    expect(source).not.toMatch(/opacity:\s*anim/);
    expect(source).toMatch(/translateY:\s*anim\.interpolate/);
  });
});
