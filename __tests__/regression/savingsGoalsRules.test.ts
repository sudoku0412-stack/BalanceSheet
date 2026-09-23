import * as fs from 'fs';
import * as path from 'path';

describe('Phase D firestore rules', () => {
  it('gates savingsGoals on household membership like incomes', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
    expect(source).toMatch(/match \/savingsGoals\/\{gid\}/);
    expect(source).toMatch(/match \/incomes\/\{iid\}/);
  });
});
