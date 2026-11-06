import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MapScreen from '../src/components/MapScreen';

jest.mock('react-native-maps', () => {
  const ReactLib = require('react');
  const ReactNative = require('react-native');
  const MockMapView = ReactLib.forwardRef(
    ({ children }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => {
      ReactLib.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
      return ReactLib.createElement(ReactNative.View, null, children);
    },
  );

  return {
    __esModule: true,
    default: MockMapView,
    Circle: ({ children }: { children?: React.ReactNode }) =>
      ReactLib.createElement(
        ReactNative.View,
        { testID: 'safe-zone-circle' },
        children,
      ),
    Marker: ({ children }: { children?: React.ReactNode }) =>
      ReactLib.createElement(ReactNative.View, null, children),
    PROVIDER_GOOGLE: 'google',
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 22.3, longitude: 70.78 },
  }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true }),
}));

const triggerInsert = jest.fn();

const client = {
  from: jest.fn((table: string) => {
    if (table === 'inhaler_count') {
      const query = {
        select: jest.fn(),
        eq: jest.fn(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { remaining_doses: 25, total_doses: 30 },
          error: null,
        }),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      return query;
    }

    return { insert: triggerInsert };
  }),
} as unknown as SupabaseClient;

const user = {
  id: 'user-123',
  email: 'person@example.com',
  user_metadata: { full_name: 'Person' },
} as unknown as User;

beforeEach(() => {
  jest.clearAllMocks();
  triggerInsert.mockResolvedValue({ error: null });
});

test('records location and Open-Meteo conditions in Supabase', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    {
      ok: true,
      json: async () => ({
        current: {
          temperature_2m: 32,
          apparent_temperature: 35,
          relative_humidity_2m: 48,
          precipitation: 0,
          weathercode: 1,
          cloudcover: 10,
          pressure_msl: 1008,
          visibility: 10000,
          wind_speed_10m: 8,
        },
        daily: { uv_index_max: [7.2] },
      }),
    } as Response,
  ).mockResolvedValueOnce(
    {
      ok: true,
      json: async () => ({
        current: { pm10: 22, pm2_5: 11, us_aqi: 42 },
      }),
    } as Response,
  );

  const holder: { current?: ReactTestRenderer.ReactTestRenderer } = {};
  await ReactTestRenderer.act(async () => {
    holder.current = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 400, height: 800 },
          insets: { top: 24, left: 0, right: 0, bottom: 24 },
        }}
      >
        <MapScreen
          client={client}
          user={user}
          onSignOut={async () => Promise.resolve()}
        />
      </SafeAreaProvider>,
    );
  });

  const app = holder.current;
  if (!app) {
    throw new Error('Map screen did not render.');
  }
  expect(
    app.root.findByProps({
      accessibilityLabel: 'Bluetooth inhaler connection information',
    }),
  ).toBeTruthy();
  expect(
    app.root.findByProps({ accessibilityLabel: 'Emergency SOS' }),
  ).toBeTruthy();
  expect(
    app.root.findByProps({
      accessibilityLabel: 'Show local air quality and weather',
    }),
  ).toBeTruthy();
  await ReactTestRenderer.act(() => {
    app.root
      .findByProps({ accessibilityLabel: 'Show 250 meter safe zone' })
      .props.onPress();
  });
  expect(app.root.findByProps({ testID: 'safe-zone-circle' })).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    await app.root.findByProps({ testID: 'record-trigger' }).props.onPress();
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toContain(
    'https://api.open-meteo.com/v1/forecast?',
  );
  expect(fetchMock.mock.calls[1][0]).toContain(
    'https://air-quality-api.open-meteo.com/v1/air-quality?',
  );
  expect(triggerInsert).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: user.id,
      latitude: 22.3,
      longitude: 70.78,
      aqi: 42,
      category: 'Good',
      pm25: 11,
      pm10: 22,
      temperature: 32,
      humidity: 48,
      notes: expect.stringContaining('Daily max UV 7.2'),
    }),
  );

  fetchMock.mockRestore();
});
