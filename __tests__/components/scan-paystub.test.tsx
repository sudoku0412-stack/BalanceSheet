import React from 'react';
import { fireEvent, render, waitFor, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///stub.jpg' }],
  })),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

jest.mock('@react-native-ml-kit/text-recognition', () => ({
  __esModule: true,
  default: {
    recognize: jest.fn(async () => ({
      blocks: [
        {
          lines: [
            { text: 'Acme Corp' },
            { text: 'Pay date: 03/15/2026' },
            { text: 'Net pay $3,210.55' },
          ],
        },
      ],
    })),
  },
}));

import ScanPaystubScreen from '../../app/scan-paystub';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';

describe('ScanPaystubScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('OCRs a chosen photo and prefills Add Income', async () => {
    render(<ScanPaystubScreen />);
    fireEvent.press(screen.getByText('Choose from photos'));

    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
      expect(TextRecognition.recognize).toHaveBeenCalledWith('file:///stub.jpg');
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/add-income',
        params: expect.objectContaining({
          amount: '3210.55',
          date: '2026-03-15',
          sourceName: 'Acme Corp',
          category: 'Salary',
        }),
      });
    });
  });
});
