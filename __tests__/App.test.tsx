/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from '../App';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
}));

jest.mock('react-native-maps', () => {
  const ReactNative = require('react-native');

  return {
    __esModule: true,
    default: () => ReactNative.createElement(ReactNative.View),
    Marker: () => null,
    PROVIDER_GOOGLE: 'google',
  };
});

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 400, height: 800 },
          insets: { top: 24, left: 0, right: 0, bottom: 24 },
        }}
      >
        <App />
      </SafeAreaProvider>,
    );
  });
});
