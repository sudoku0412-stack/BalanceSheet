import * as fs from 'fs';
import * as path from 'path';

describe('Phase C routes are registered', () => {
  it('registers incomes, scan-paystub, and savings-goals stack screens', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(source).not.toMatch(/name="import-income"/);
    expect(source).toMatch(/name="incomes"/);
    expect(source).toMatch(/name="scan-paystub"/);
    expect(source).toMatch(/name="savings-goals"/);
  });

  it('whitelists those routes so the auth guard does not bounce them to Home', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
    const whitelistMatch = source.match(/STICKY_VOLUNTARY\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(whitelistMatch).not.toBeNull();
    const whitelistItems = whitelistMatch![1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect(whitelistItems).toEqual(
      expect.arrayContaining(['incomes', 'scan-paystub', 'savings-goals']),
    );
    expect(whitelistItems).not.toContain('import-income');
  });
});
