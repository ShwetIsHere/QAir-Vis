import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MapScreen from '../src/components/MapScreen';

const mockFitToCoordinates = jest.fn();

jest.mock('react-native-maps', () => {
  const ReactLib = require('react');
  const ReactNative = require('react-native');
  const MockMapView = ReactLib.forwardRef(
    (
      {
        children,
        onMapReady,
      }: {
        children?: React.ReactNode;
        onMapReady?: () => void;
      },
      ref: React.Ref<unknown>,
    ) => {
      ReactLib.useImperativeHandle(ref, () => ({
        animateToRegion: jest.fn(),
        fitToCoordinates: mockFitToCoordinates,
      }));
      ReactLib.useEffect(() => onMapReady?.(), [onMapReady]);
      return ReactLib.createElement(ReactNative.View, null, children);
    },
  );

  return {
    __esModule: true,
    default: MockMapView,
    Circle: ({
      children,
      radius,
    }: {
      children?: React.ReactNode;
      radius: number;
    }) =>
      ReactLib.createElement(
        ReactNative.View,
        {
          testID:
            radius === 200
              ? 'red-zone-circle'
              : radius === 100
              ? 'yellow-zone-circle'
              : 'safe-zone-circle',
        },
        children,
      ),
    Marker: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => ReactLib.createElement(ReactNative.View, props, children),
    PROVIDER_GOOGLE: 'google',
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, Highest: 6 },
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 22.3, longitude: 70.78 },
  }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true }),
  reverseGeocodeAsync: jest
    .fn()
    .mockResolvedValue([
      { city: 'Rajkot', region: 'Gujarat', country: 'India' },
    ]),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notification-id'),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  setNotificationHandler: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn().mockResolvedValue(null),
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(null),
}));

const triggerInsert = jest.fn();
const triggerRange = jest.fn();
const triggerFunction = jest.fn();
const triggerSelect = jest.fn();
let triggerRecords: Array<Record<string, unknown>> = [];
let triggerQueryError: { code: string; message: string; hint?: string } | null =
  null;
let missingWeatherColumnOnce = false;

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

    if (table === 'inhaler_triggers') {
      const query = {
        select: jest.fn(),
        eq: jest.fn(),
        order: jest.fn(),
        range: triggerRange,
        insert: triggerInsert,
      };
      query.select.mockImplementation((columns: string): typeof query => {
        triggerSelect(columns);
        return query;
      });
      query.eq.mockReturnValue(query);
      query.order.mockReturnValue(query);
      return query;
    }

    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  }),
  functions: { invoke: triggerFunction },
} as unknown as SupabaseClient;

const user = {
  id: 'user-123',
  email: 'person@example.com',
  user_metadata: { full_name: 'Person' },
} as unknown as User;

beforeEach(() => {
  jest.clearAllMocks();
  mockFitToCoordinates.mockClear();
  triggerSelect.mockClear();
  triggerRecords = [];
  triggerQueryError = null;
  missingWeatherColumnOnce = false;
  triggerRange.mockImplementation(async () => ({
    data: triggerRecords,
    error: missingWeatherColumnOnce
      ? (() => {
          missingWeatherColumnOnce = false;
          return {
            code: '42703',
            message: 'column inhaler_triggers.wind_speed_180m does not exist',
          };
        })()
      : triggerQueryError,
  }));
  triggerInsert.mockResolvedValue({ error: null });
  triggerFunction.mockResolvedValue({
    data: { suggestion: 'Check the AQI before spending time outdoors.' },
    error: null,
  });
});

async function renderMap() {
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
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });

  if (!holder.current) {
    throw new Error('Map screen did not render.');
  }
  return holder.current;
}

function openMeteoFetchMock() {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        current: {
          time: '2026-04-10T12:15',
          temperature_2m: 32,
          apparent_temperature: 35,
          relative_humidity_2m: 48,
          precipitation: 0,
          showers: 0,
          dew_point_2m: 20,
          weathercode: 1,
          cloudcover: 10,
          pressure_msl: 1008,
          surface_pressure: 1007,
          visibility: 10000,
          wind_speed_10m: 8,
          wind_speed_180m: 20,
        },
        hourly: {
          time: ['2026-04-10T12:00', '2026-04-10T13:00'],
          precipitation: [0, 0],
          showers: [0, 0],
        },
        daily: { uv_index_max: [7.2] },
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        current: { pm10: 22, pm2_5: 11, us_aqi: 42 },
      }),
    } as Response);
}

function containsText(
  app: ReactTestRenderer.ReactTestRenderer,
  expected: string,
) {
  return app.root.findAllByType(Text).some(node => {
    const children = node.props.children;
    return Array.isArray(children)
      ? children.join('') === expected
      : children === expected;
  });
}

test('records location and Open-Meteo conditions in Supabase', async () => {
  const fetchMock = openMeteoFetchMock();
  const app = await renderMap();
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
    await app.root
      .findByProps({ accessibilityLabel: 'Show my location' })
      .props.onPress();
  });
  const location = jest.requireMock('expo-location') as {
    getCurrentPositionAsync: jest.Mock;
  };
  expect(location.getCurrentPositionAsync).toHaveBeenLastCalledWith({
    accuracy: 6,
  });

  await ReactTestRenderer.act(async () => {
    await app.root.findByProps({ testID: 'record-trigger' }).props.onPress();
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toContain(
    'https://api.open-meteo.com/v1/forecast?',
  );
  expect(fetchMock.mock.calls[0][0]).toContain('wind_speed_180m');
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
      wind_speed_180m: 20,
      showers: 0,
      precipitation_next_hour: 0,
      showers_next_hour: 0,
      dew_point_2m: 20,
      surface_pressure: 1007,
      pressure_msl: 1008,
      notes: expect.stringContaining('Daily max UV 7.2'),
    }),
  );

  fetchMock.mockRestore();
});

test('records location even when Open-Meteo is unavailable', async () => {
  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Network request failed'));
  const app = await renderMap();

  await ReactTestRenderer.act(async () => {
    await app.root.findByProps({ testID: 'record-trigger' }).props.onPress();
  });

  expect(triggerInsert).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: user.id,
      latitude: 22.3,
      longitude: 70.78,
      aqi: null,
      temperature: null,
      notes: expect.stringContaining('Weather and air-quality readings'),
    }),
  );
  expect(
    containsText(app, 'Trigger recorded. Weather readings were unavailable.'),
  ).toBe(true);
  fetchMock.mockRestore();
});

test('retries trigger insert with core fields when optional columns are missing', async () => {
  const fetchMock = openMeteoFetchMock();
  triggerInsert
    .mockResolvedValueOnce({
      error: {
        code: 'PGRST204',
        message: 'Could not find wind_speed_180m in the schema cache',
      },
    })
    .mockResolvedValueOnce({ error: null });
  const app = await renderMap();

  await ReactTestRenderer.act(async () => {
    await app.root.findByProps({ testID: 'record-trigger' }).props.onPress();
  });

  expect(triggerInsert).toHaveBeenCalledTimes(2);
  expect(triggerInsert.mock.calls[0][0]).toHaveProperty('wind_speed_180m', 20);
  expect(triggerInsert.mock.calls[1][0]).not.toHaveProperty('wind_speed_180m');
  expect(containsText(app, 'Trigger recorded · AQI 42 · 32°C')).toBe(true);
  fetchMock.mockRestore();
});

test('renders recorded marks and opens the weather detail view', async () => {
  const trigger = {
    id: 'trigger-1',
    user_id: user.id,
    latitude: 22.3,
    longitude: 70.78,
    aqi: 42,
    category: 'Good',
    pm25: 11,
    pm10: 22,
    temperature: 32,
    humidity: 48,
    wind_speed_180m: 18,
    showers: 0.2,
    precipitation_next_hour: 0,
    showers_next_hour: 0,
    dew_point_2m: 21,
    surface_pressure: 1007,
    pressure_msl: 1008,
    notes: 'Recorded conditions',
    timestamp: '2026-04-10T12:00:00.000Z',
  };
  triggerRecords = [trigger];
  const fetchMock = openMeteoFetchMock();
  const app = await renderMap();

  expect(
    app.root.findAllByProps({ testID: 'trigger-marker' }).length,
  ).toBeGreaterThan(0);
  expect(mockFitToCoordinates).toHaveBeenCalledWith(
    [{ latitude: 22.3, longitude: 70.78 }],
    expect.objectContaining({ animated: true }),
  );
  await ReactTestRenderer.act(async () => {
    app.root.findAllByProps({ testID: 'trigger-marker' })[0].props.onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  expect(containsText(app, 'Location Weather')).toBe(true);
  expect(containsText(app, 'Wind (180 m)')).toBe(true);
  expect(containsText(app, 'Showers')).toBe(true);
  expect(containsText(app, 'Additional Information')).toBe(true);
  expect(containsText(app, 'No precipitation within an hour')).toBe(true);

  await ReactTestRenderer.act(async () => {
    app.root
      .findByProps({
        accessibilityLabel: 'Get environmental care suggestion',
      })
      .props.onPress();
  });
  expect(triggerFunction).toHaveBeenCalledWith(
    'weather-suggestion',
    expect.objectContaining({
      body: expect.objectContaining({
        environment: expect.objectContaining({
          aqi: 42,
          pm25: 11,
          pm10: 22,
          windSpeed180m: 20,
          showers: 0,
          precipitationNextHour: 0,
          showersNextHour: 0,
        }),
      }),
    }),
  );
  expect(
    containsText(app, 'Check the AQI before spending time outdoors.'),
  ).toBe(true);
  fetchMock.mockRestore();
});

test('shows the Edge Function error body for failed suggestions', async () => {
  const trigger = {
    id: 'trigger-error',
    user_id: user.id,
    latitude: 22.3,
    longitude: 70.78,
    aqi: 42,
    category: 'Good',
    pm25: 11,
    pm10: 22,
    temperature: 32,
    humidity: 48,
    notes: null,
    timestamp: '2026-04-10T12:00:00.000Z',
  };
  triggerRecords = [trigger];
  const fetchMock = openMeteoFetchMock();
  const app = await renderMap();
  await ReactTestRenderer.act(async () => {
    app.root.findAllByProps({ testID: 'trigger-marker' })[0].props.onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  triggerFunction.mockResolvedValue({
    data: null,
    error: Object.assign(
      new Error('Edge Function returned a non-2xx status code'),
      {
        context: new Response(
          JSON.stringify({
            error: 'Groq could not generate a suggestion.',
            details: 'Invalid API key',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        ),
      },
    ),
  });

  await ReactTestRenderer.act(async () => {
    app.root
      .findByProps({
        accessibilityLabel: 'Get environmental care suggestion',
      })
      .props.onPress();
  });
  expect(
    containsText(
      app,
      'Groq could not generate a suggestion. (Invalid API key)',
    ),
  ).toBe(true);
  fetchMock.mockRestore();
});

test('shows and notifies when five or more triggers are within 200 meters', async () => {
  triggerRecords = Array.from({ length: 5 }, (_, index) => ({
    id: `trigger-${index}`,
    user_id: user.id,
    latitude: 22.3,
    longitude: 70.78,
    aqi: 42,
    category: 'Good',
    pm25: 11,
    pm10: 22,
    temperature: 32,
    humidity: 48,
    notes: null,
    timestamp: '2026-04-10T12:00:00.000Z',
  }));

  const app = await renderMap();
  expect(app.root.findByProps({ testID: 'red-zone-circle' })).toBeTruthy();
  expect(containsText(app, 'RED ZONE · 5 triggers within 200 m')).toBe(true);
  const notifications = jest.requireMock('expo-notifications') as {
    scheduleNotificationAsync: jest.Mock;
  };
  expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({ title: 'Red zone alert' }),
      trigger: null,
    }),
  );
});

test('shows a yellow zone for three or four nearby triggers', async () => {
  triggerRecords = Array.from({ length: 4 }, (_, index) => ({
    id: `trigger-${index}`,
    user_id: user.id,
    latitude: 22.3,
    longitude: 70.78,
    aqi: 42,
    category: 'Good',
    pm25: 11,
    pm10: 22,
    temperature: 32,
    humidity: 48,
    notes: null,
    timestamp: '2026-04-10T12:00:00.000Z',
  }));

  const app = await renderMap();
  expect(app.root.findByProps({ testID: 'yellow-zone-circle' })).toBeTruthy();
  expect(containsText(app, 'YELLOW ZONE · 4 triggers within 100 m')).toBe(true);
  const notifications = jest.requireMock('expo-notifications') as {
    scheduleNotificationAsync: jest.Mock;
  };
  expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('shows the Supabase error when trigger rows cannot be loaded', async () => {
  triggerQueryError = {
    code: '42501',
    message: 'permission denied for table inhaler_triggers',
    hint: 'Check the table grants and row-level security policies.',
  };
  const app = await renderMap();
  expect(
    containsText(
      app,
      'Couldn’t load map marks: Could not load your recorded triggers: permission denied for table inhaler_triggers [42501] Check the table grants and row-level security policies. Run supabase-rls.sql in the Supabase SQL Editor while signed in as the project owner.',
    ),
  ).toBe(true);
});

test('falls back to core trigger columns when the weather migration is not applied', async () => {
  triggerRecords = [
    {
      id: 'legacy-trigger',
      user_id: user.id,
      latitude: 22.3,
      longitude: 70.78,
      aqi: 42,
      category: 'Good',
      pm25: 11,
      pm10: 22,
      temperature: 32,
      humidity: 48,
      notes: null,
      timestamp: '2026-04-10T12:00:00.000Z',
    },
  ];
  missingWeatherColumnOnce = true;

  const app = await renderMap();
  expect(
    app.root.findAllByProps({ testID: 'trigger-marker' }).length,
  ).toBeGreaterThan(0);
  expect(triggerSelect).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining('wind_speed_180m'),
  );
  expect(triggerSelect).toHaveBeenNthCalledWith(
    2,
    'id, user_id, latitude, longitude, aqi, category, pm25, pm10, temperature, humidity, notes, timestamp',
  );
  expect(containsText(app, 'Couldn’t load map marks.')).toBe(false);
});
