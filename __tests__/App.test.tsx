/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

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
    ReactTestRenderer.create(<App />);
  });
});
