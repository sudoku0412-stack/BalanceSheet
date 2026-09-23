import { lightTheme } from '../../constants/theme';

describe('lightTheme', () => {
  it('uses a cool paper background instead of dingy cream', () => {
    expect(lightTheme.colors.background).toBe('#F4F6FB');
    expect(lightTheme.colors.surface).toBe('#FFFFFF');
    expect(lightTheme.isDark).toBe(false);
  });

  it('uses tinted card fills so light-theme cards read against the paper', () => {
    expect(lightTheme.colors.surfaceCard).toBe('#E4ECF8');
    expect(lightTheme.colors.cardTint.sky).not.toBe(lightTheme.colors.background);
    expect(lightTheme.colors.cardTint.mint).not.toBe('#FFFFFF');
    expect(lightTheme.colors.chartRemaining).toBe('#8B95AD');
  });

  it('uses a brighter accent and teal success', () => {
    expect(lightTheme.colors.accent).toBe('#3E5FBF');
    expect(lightTheme.colors.success).toBe('#1F8A75');
    expect(lightTheme.colors.textPrimary).toBe('#12141F');
  });

  it('uses saturated category colors that stay distinct on a light donut', () => {
    expect(lightTheme.colors.category.Groceries).toBe('#1DB37A');
    expect(lightTheme.colors.category.Electronics).toBe('#2F6BFF');
    expect(lightTheme.colors.category.Dining).toBe('#F06B2A');
    expect(lightTheme.colors.category.Other).toBe('#4A5D8A');
  });
});
