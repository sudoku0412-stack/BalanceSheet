import * as fs from 'fs';
import * as path from 'path';

describe('Phase C routes are registered', () => {
  it('registers incomes, scan-paystub, and savings-goals stack screens', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(source).not.toMatch(/name="import-income"/);
    expect(source).toMatch(/name="incomes"/);
    expect(source).toMatch(/name="scan-paystub"/);
    expect(source).toMatch(/name="savings-goals"/);
    expect(source).toMatch(/hrefForAuthGuard/);
    expect(source).toMatch(/scheduleRouteReplace/);
    expect(source).toMatch(/Stack\.Protected/);
  });

  it('whitelists those routes so the auth guard does not bounce them to Home', () => {
    const { STICKY_VOLUNTARY } = require('../../lib/routeGuard');
    expect([...STICKY_VOLUNTARY]).toEqual(
      expect.arrayContaining(['incomes', 'scan-paystub', 'savings-goals']),
    );
    expect([...STICKY_VOLUNTARY]).not.toContain('import-income');
  });
});
