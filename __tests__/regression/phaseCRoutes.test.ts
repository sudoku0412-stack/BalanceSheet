import * as fs from 'fs';
import * as path from 'path';

describe('Phase C routes are registered', () => {
  it('registers import-income, scan-paystub, and savings-goals stack screens', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(source).toMatch(/name="import-income"/);
    expect(source).toMatch(/name="scan-paystub"/);
    expect(source).toMatch(/name="savings-goals"/);
  });
});
