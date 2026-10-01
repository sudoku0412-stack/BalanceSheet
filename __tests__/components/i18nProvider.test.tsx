import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';

jest.mock('../../lib/secureStorage', () => ({
  getLanguagePreference: jest.fn(),
  setLanguagePreference: jest.fn(async () => undefined),
}));

import { I18nProvider, useLanguage, useT } from '../../lib/I18nContext';
import { getActiveLanguage, setActiveLanguage } from '../../lib/i18n';
import { getLanguagePreference, setLanguagePreference } from '../../lib/secureStorage';

const mockGetPref = getLanguagePreference as jest.Mock;
const mockSetPref = setLanguagePreference as jest.Mock;

function Probe() {
  const t = useT();
  const { language, preference, setPreference } = useLanguage();
  return (
    <>
      <Text testID="cancel">{t('cancel')}</Text>
      <Text testID="count">{t('expensesThisMonth', { count: 1 })}</Text>
      <Text testID="lang">{`${language}:${preference}`}</Text>
      <TouchableOpacity testID="to-fr" onPress={() => setPreference('fr')} />
      <TouchableOpacity testID="to-en" onPress={() => setPreference('en')} />
      <TouchableOpacity testID="to-system" onPress={() => setPreference('system')} />
    </>
  );
}

function mockDeviceLocale(locale: string) {
  return jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    () => ({ resolvedOptions: () => ({ locale }) }) as unknown as Intl.DateTimeFormat,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPref.mockResolvedValue('system');
  setActiveLanguage('en');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('without a provider', () => {
  it('falls back to English', () => {
    render(<Probe />);
    expect(screen.getByTestId('cancel').props.children).toBe('Cancel');
    expect(screen.getByTestId('lang').props.children).toBe('en:system');
  });
});

describe('I18nProvider', () => {
  it('uses the saved preference', async () => {
    mockGetPref.mockResolvedValue('fr');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('cancel').props.children).toBe('Annuler'));
    expect(screen.getByTestId('lang').props.children).toBe('fr:fr');
    expect(screen.getByTestId('count').props.children).toBe('1 dépense ce mois-ci');
  });

  it('system preference follows a French device', async () => {
    mockDeviceLocale('fr-CA');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('cancel').props.children).toBe('Annuler'));
    expect(screen.getByTestId('lang').props.children).toBe('fr:system');
  });

  it('system preference stays English on an unsupported device language', async () => {
    mockDeviceLocale('de-DE');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(mockGetPref).toHaveBeenCalled());
    expect(screen.getByTestId('cancel').props.children).toBe('Cancel');
  });

  it('switching language updates the UI, the active language, and persists', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(mockGetPref).toHaveBeenCalled());
    expect(screen.getByTestId('cancel').props.children).toBe('Cancel');

    fireEvent.press(screen.getByTestId('to-fr'));
    await waitFor(() => expect(screen.getByTestId('cancel').props.children).toBe('Annuler'));
    expect(getActiveLanguage()).toBe('fr');
    expect(mockSetPref).toHaveBeenCalledWith('fr');

    fireEvent.press(screen.getByTestId('to-en'));
    await waitFor(() => expect(screen.getByTestId('cancel').props.children).toBe('Cancel'));
    expect(getActiveLanguage()).toBe('en');
    expect(mockSetPref).toHaveBeenLastCalledWith('en');
  });

  it('survives a storage failure and stays on the default', async () => {
    mockGetPref.mockRejectedValue(new Error('secure store down'));
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('cancel').props.children).toBe('Cancel');
  });
});
