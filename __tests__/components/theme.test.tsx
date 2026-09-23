import { lightTheme } from '../../constants/theme';

describe('lightTheme', () => {
  it('uses a cool paper background instead of dingy cream', () => {
    expect(lightTheme.colors.background).toBe('#F4F6FB');
    expect(lightTheme.colors.surface).toBe('#FFFFFF');
    expect(lightTheme.isDark).toBe(false);
  });

  it('uses a brighter accent and teal success', () => {
    expect(lightTheme.colors.accent).toBe('#3E5FBF');
    expect(lightTheme.colors.success).toBe('#1F8A75');
    expect(lightTheme.colors.textPrimary).toBe('#12141F');
  });
});
