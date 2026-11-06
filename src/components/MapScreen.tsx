import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, {
  Circle,
  Marker,
  PROVIDER_GOOGLE,
  type LatLng,
  type Region,
} from 'react-native-maps';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { fetchEnvironment, getAqiCategory } from '../lib/environment';
import type { Environment } from '../lib/environment';
import TriggerDetailScreen from './TriggerDetailScreen';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type MapScreenProps = {
  client: SupabaseClient;
  user: User;
  onSignOut: () => Promise<void>;
};

type InhalerCount = {
  remaining_doses: number;
  total_doses: number;
};

export type TriggerRecord = {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  aqi: number | null;
  category: string | null;
  pm25: number | null;
  pm10: number | null;
  temperature: number | null;
  humidity: number | null;
  wind_speed_180m?: number | null;
  showers?: number | null;
  precipitation_next_hour?: number | null;
  showers_next_hour?: number | null;
  dew_point_2m?: number | null;
  surface_pressure?: number | null;
  pressure_msl?: number | null;
  notes: string | null;
  timestamp: string;
};

const defaultRegion: Region = {
  latitude: 22.3,
  longitude: 70.78,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

function distanceMeters(
  first: Pick<LatLng, 'latitude' | 'longitude'>,
  second: Pick<LatLng, 'latitude' | 'longitude'>,
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function isTriggerRecord(value: unknown): value is TriggerRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.user_id === 'string' &&
    typeof record.latitude === 'number' &&
    Number.isFinite(record.latitude) &&
    typeof record.longitude === 'number' &&
    Number.isFinite(record.longitude) &&
    typeof record.timestamp === 'string'
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') {
    return 'Unexpected database error.';
  }

  const details = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const message =
    typeof details.message === 'string'
      ? details.message
      : 'Unexpected database error.';
  const code = typeof details.code === 'string' ? ` [${details.code}]` : '';
  const extra =
    typeof details.details === 'string' && details.details
      ? ` ${details.details}`
      : typeof details.hint === 'string' && details.hint
      ? ` ${details.hint}`
      : '';
  return `${message}${code}${extra}`;
}

function getTriggerLoadHint(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  const details = error as { code?: unknown; message?: unknown };
  const message =
    typeof details.message === 'string' ? details.message.toLowerCase() : '';

  if (
    details.code === '42501' ||
    message.includes('permission denied') ||
    message.includes('row-level security')
  ) {
    return ' Run supabase-rls.sql in the Supabase SQL Editor while signed in as the project owner.';
  }
  if (
    details.code === '42P01' ||
    details.code === 'PGRST205' ||
    message.includes('does not exist')
  ) {
    return ' Create public.inhaler_triggers using supabase.sql, then run supabase-rls.sql.';
  }
  return '';
}

function isMissingTriggerWeatherColumn(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const details = error as { code?: unknown; message?: unknown };
  const message =
    typeof details.message === 'string' ? details.message.toLowerCase() : '';
  return (
    details.code === '42703' ||
    details.code === 'PGRST204' ||
    (message.includes('column') &&
      (message.includes('does not exist') || message.includes('schema cache')))
  );
}

export default function MapScreen({ client, user, onSignOut }: MapScreenProps) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  const hasAutoFittedTriggers = useRef(false);
  const [region, setRegion] = useState(defaultRegion);
  const [deviceCoordinate, setDeviceCoordinate] = useState<LatLng | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [count, setCount] = useState<InhalerCount | null>(null);
  const [countError, setCountError] = useState('');
  const [countLoading, setCountLoading] = useState(true);
  const [triggers, setTriggers] = useState<TriggerRecord[]>([]);
  const [triggersLoading, setTriggersLoading] = useState(true);
  const [triggersError, setTriggersError] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [recordingTrigger, setRecordingTrigger] = useState(false);
  const [triggerMessage, setTriggerMessage] = useState('');
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const [environmentError, setEnvironmentError] = useState('');
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [safeZoneEnabled, setSafeZoneEnabled] = useState(false);
  const [sosBusy, setSosBusy] = useState(false);
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerRecord | null>(
    null,
  );
  const [nearbyTriggerCount, setNearbyTriggerCount] = useState(0);
  const [nearbyYellowCount, setNearbyYellowCount] = useState(0);
  const [redZoneError, setRedZoneError] = useState('');
  const redZoneAlerted = useRef(false);
  const redZoneNotificationPending = useRef(false);
  const notificationPermissionRequested = useRef(false);

  const loadTriggers = useCallback(async () => {
    setTriggersLoading(true);
    setTriggersError('');
    try {
      const pageSize = 500;
      const allTriggers: TriggerRecord[] = [];
      let includeWeatherColumns = true;
      for (let from = 0; ; from += pageSize) {
        const fetchPage = (includeExtendedColumns: boolean) =>
          client
            .from('inhaler_triggers')
            .select(
              includeExtendedColumns
                ? 'id, user_id, latitude, longitude, aqi, category, pm25, pm10, temperature, humidity, wind_speed_180m, showers, precipitation_next_hour, showers_next_hour, dew_point_2m, surface_pressure, pressure_msl, notes, timestamp'
                : 'id, user_id, latitude, longitude, aqi, category, pm25, pm10, temperature, humidity, notes, timestamp',
            )
            .eq('user_id', user.id)
            .order('timestamp', { ascending: false })
            .range(from, from + pageSize - 1);

        let { data, error } = await fetchPage(includeWeatherColumns);
        if (
          error &&
          includeWeatherColumns &&
          isMissingTriggerWeatherColumn(error)
        ) {
          includeWeatherColumns = false;
          ({ data, error } = await fetchPage(false));
        }
        if (error) {
          throw error;
        }

        const rows: unknown = data;
        const page = Array.isArray(rows) ? rows.filter(isTriggerRecord) : [];
        allTriggers.push(...page);
        if (page.length < pageSize) {
          break;
        }
      }
      setTriggers(allTriggers);
    } catch (error) {
      setTriggersError(
        `Could not load your recorded triggers: ${getErrorMessage(
          error,
        )}${getTriggerLoadHint(error)}`,
      );
    } finally {
      setTriggersLoading(false);
    }
  }, [client, user.id]);

  const loadCount = useCallback(async () => {
    setCountLoading(true);
    setCountError('');
    try {
      const { data, error } = await client
        .from('inhaler_count')
        .select('remaining_doses, total_doses')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (data) {
        setCount({
          remaining_doses: data.remaining_doses,
          total_doses: data.total_doses,
        });
        return;
      }

      const { data: created, error: insertError } = await client
        .from('inhaler_count')
        .insert({ user_id: user.id })
        .select('remaining_doses, total_doses')
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          const { data: existing, error: fetchError } = await client
            .from('inhaler_count')
            .select('remaining_doses, total_doses')
            .eq('user_id', user.id)
            .single();
          if (fetchError) {
            throw fetchError;
          }
          setCount(existing);
          return;
        }
        throw insertError;
      }

      setCount(created);
    } catch (loadError) {
      setCountError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load your inhaler count.',
      );
    } finally {
      setCountLoading(false);
    }
  }, [client, user.id]);

  const loadEnvironment = useCallback(
    async (coordinate = deviceCoordinate) => {
      if (!coordinate) {
        setEnvironmentError('Location is not ready yet.');
        return null;
      }

      setEnvironmentLoading(true);
      setEnvironmentError('');
      try {
        const result = await fetchEnvironment(
          coordinate.latitude,
          coordinate.longitude,
        );
        setEnvironment(result);
        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Could not load environmental conditions.';
        setEnvironmentError(message);
        return null;
      } finally {
        setEnvironmentLoading(false);
      }
    },
    [deviceCoordinate],
  );

  const evaluateRedZone = useCallback(async () => {
    if (!deviceCoordinate) {
      return;
    }

    const nearbyCount = triggers.filter(
      trigger => distanceMeters(deviceCoordinate, trigger) <= 200,
    ).length;
    const yellowCount = triggers.filter(
      trigger => distanceMeters(deviceCoordinate, trigger) <= 100,
    ).length;
    setNearbyTriggerCount(nearbyCount);
    setNearbyYellowCount(yellowCount);
    const insideRedZone = nearbyCount >= 5;

    if (!insideRedZone) {
      redZoneAlerted.current = false;
      notificationPermissionRequested.current = false;
      setRedZoneError('');
      return;
    }

    if (redZoneAlerted.current || redZoneNotificationPending.current) {
      return;
    }

    redZoneNotificationPending.current = true;
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('health-alerts', {
          name: 'Health alerts',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#ef4444',
        });
      }

      let permission = await Notifications.getPermissionsAsync();
      if (
        permission.status !== 'granted' &&
        !notificationPermissionRequested.current
      ) {
        notificationPermissionRequested.current = true;
        permission = await Notifications.requestPermissionsAsync();
      }
      if (permission.status !== 'granted') {
        setRedZoneError(
          'Red zone detected. Enable notifications to receive health alerts.',
        );
        return;
      }

      notificationPermissionRequested.current = false;
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Red zone alert',
          body: `${nearbyCount} triggers are within 200 m. You are in a red zone.`,
          sound: true,
        },
        trigger: null,
      });
      if (!notificationId) {
        throw new Error('The notification was not scheduled.');
      }
      redZoneAlerted.current = true;
      setRedZoneError('');
    } catch (error) {
      setRedZoneError(
        error instanceof Error
          ? `Red zone detected, but notification failed: ${error.message}`
          : 'Red zone detected, but notification failed.',
      );
    } finally {
      redZoneNotificationPending.current = false;
    }
  }, [deviceCoordinate, triggers]);

  useEffect(() => {
    loadCount();
  }, [loadCount]);

  useEffect(() => {
    loadTriggers();
  }, [loadTriggers]);

  useEffect(() => {
    if (
      !mapReady ||
      triggersLoading ||
      triggersError ||
      triggers.length === 0 ||
      hasAutoFittedTriggers.current
    ) {
      return;
    }

    mapRef.current?.fitToCoordinates(
      triggers.map(trigger => ({
        latitude: trigger.latitude,
        longitude: trigger.longitude,
      })),
      {
        edgePadding: { top: 180, right: 60, bottom: 180, left: 60 },
        animated: true,
      },
    );
    hasAutoFittedTriggers.current = true;
  }, [mapReady, triggers, triggersError, triggersLoading]);

  useEffect(() => {
    evaluateRedZone();
  }, [evaluateRedZone]);

  useEffect(() => {
    let active = true;
    let locationSubscription: Location.LocationSubscription | undefined;

    async function locateUser() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!active) {
          return;
        }
        if (!permission.granted) {
          setLocationMessage('Allow location access to show your position.');
          return;
        }

        setHasLocationPermission(true);
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });
        if (!active) {
          return;
        }

        const nextRegion: Region = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        };
        setDeviceCoordinate({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setRegion(nextRegion);
        mapRef.current?.animateToRegion(nextRegion, 700);
        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Highest,
            distanceInterval: 10,
            timeInterval: 10_000,
          },
          nextPosition => {
            if (active) {
              setDeviceCoordinate({
                latitude: nextPosition.coords.latitude,
                longitude: nextPosition.coords.longitude,
              });
            }
          },
        );
        if (!active) {
          locationSubscription.remove();
        }
      } catch {
        if (active) {
          setLocationMessage(
            'Could not get your location. Check device location settings.',
          );
        }
      }
    }

    locateUser();
    return () => {
      active = false;
      locationSubscription?.remove();
    };
  }, []);

  const locateAgain = useCallback(async () => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        const requested = await Location.requestForegroundPermissionsAsync();
        if (!requested.granted) {
          setLocationMessage('Allow location access to show your position.');
          return;
        }
      }

      setHasLocationPermission(true);
      setLocationMessage('');
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      const nextRegion: Region = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      };
      setDeviceCoordinate({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setLocationMessage(
        position.coords.accuracy !== null && position.coords.accuracy > 20
          ? `Current location accuracy is ±${Math.round(
              position.coords.accuracy,
            )} m; move outdoors for a stronger GPS fix.`
          : '',
      );
      setRegion(nextRegion);
      mapRef.current?.animateToRegion(nextRegion, 700);
    } catch {
      setLocationMessage(
        'Could not get your location. Check device location settings.',
      );
    }
  }, []);

  const signOut = useCallback(async () => {
    setSignOutError('');
    try {
      await onSignOut();
    } catch (error) {
      setSignOutError(
        error instanceof Error
          ? error.message
          : 'Could not sign out. Try again.',
      );
    }
  }, [onSignOut]);

  const showBluetoothInfo = useCallback(() => {
    Alert.alert(
      'Bluetooth inhaler',
      'Bluetooth is available in this design, but live inhaler pairing needs a native development build with a BLE module. Expo Go does not include that module.',
      [{ text: 'OK' }],
    );
  }, []);

  const callPhoneNumber = useCallback((phoneNumber: string) => {
    const dialable = phoneNumber.replace(/[^\d+*#,;]/g, '');
    if (!dialable) {
      Alert.alert(
        'Invalid phone number',
        'The saved emergency number is invalid.',
      );
      return;
    }

    Linking.openURL(`tel:${dialable}`).catch(() => {
      Alert.alert(
        'Unable to call',
        'Your device could not open the phone app.',
      );
    });
  }, []);

  const openSos = useCallback(async () => {
    if (sosBusy) {
      return;
    }

    setSosBusy(true);
    try {
      const { data: contact, error } = await client
        .from('emergency_contacts')
        .select('name, phone_number')
        .eq('user_id', user.id)
        .eq('is_primary', true)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const actions = contact
        ? [
            {
              text: `Call ${contact.name}`,
              onPress: () => callPhoneNumber(contact.phone_number),
            },
            {
              text: 'Call 112',
              style: 'destructive' as const,
              onPress: () => callPhoneNumber('112'),
            },
            { text: 'Cancel', style: 'cancel' as const },
          ]
        : [
            {
              text: 'Call 112',
              style: 'destructive' as const,
              onPress: () => callPhoneNumber('112'),
            },
            { text: 'Cancel', style: 'cancel' as const },
          ];

      Alert.alert(
        'Emergency SOS',
        contact
          ? `Call your primary emergency contact, ${contact.name}, or emergency services (112)?`
          : 'No primary emergency contact is saved. Call emergency services (112)?',
        actions,
      );
    } catch (error) {
      Alert.alert(
        'Emergency contact unavailable',
        error instanceof Error
          ? `${error.message}\n\nYou can still call emergency services (112).`
          : 'You can still call emergency services (112).',
        [
          {
            text: 'Call 112',
            style: 'destructive',
            onPress: () => callPhoneNumber('112'),
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } finally {
      setSosBusy(false);
    }
  }, [callPhoneNumber, client, sosBusy, user.id]);

  const recordTrigger = useCallback(async () => {
    setRecordingTrigger(true);
    setTriggerMessage('');
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        throw new Error('Allow location access before recording a trigger.');
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coordinate = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setHasLocationPermission(true);
      setDeviceCoordinate(coordinate);
      mapRef.current?.animateToRegion(
        { ...coordinate, latitudeDelta: 0.008, longitudeDelta: 0.008 },
        500,
      );

      const currentEnvironment = await loadEnvironment(coordinate);
      const triggerData = {
        user_id: user.id,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        aqi: currentEnvironment ? Math.round(currentEnvironment.aqi) : null,
        category: currentEnvironment
          ? getAqiCategory(currentEnvironment.aqi)
          : null,
        pm25: currentEnvironment?.pm25 ?? null,
        pm10: currentEnvironment?.pm10 ?? null,
        temperature: currentEnvironment?.temperature ?? null,
        humidity: currentEnvironment?.humidity ?? null,
        wind_speed_180m: currentEnvironment?.windSpeed180m ?? null,
        showers: currentEnvironment?.showers ?? null,
        precipitation_next_hour:
          currentEnvironment?.precipitationNextHour ?? null,
        showers_next_hour: currentEnvironment?.showersNextHour ?? null,
        dew_point_2m: currentEnvironment?.dewPoint ?? null,
        surface_pressure: currentEnvironment?.surfacePressure ?? null,
        pressure_msl: currentEnvironment?.pressure ?? null,
        notes: currentEnvironment
          ? [
              'Recorded from the map.',
              `Feels like ${currentEnvironment.apparentTemperature}°C`,
              `Precipitation ${currentEnvironment.precipitation} mm`,
              `Weather code ${currentEnvironment.weatherCode}`,
              `Cloud cover ${currentEnvironment.cloudCover}%`,
              `Pressure ${currentEnvironment.pressure} hPa`,
              `Visibility ${currentEnvironment.visibility} m`,
              `Wind ${currentEnvironment.windSpeed} km/h`,
              `Wind at 180 m ${currentEnvironment.windSpeed180m} km/h`,
              `Showers ${currentEnvironment.showers} mm`,
              `Precipitation next hour ${
                currentEnvironment.precipitationNextHour ?? 'unavailable'
              } mm`,
              `Showers next hour ${
                currentEnvironment.showersNextHour ?? 'unavailable'
              } mm`,
              `Dew point ${currentEnvironment.dewPoint}°C`,
              `Surface pressure ${currentEnvironment.surfacePressure} hPa`,
              `Pressure (MSL) ${currentEnvironment.pressure} hPa`,
              currentEnvironment.uvIndex === null
                ? null
                : `Daily max UV ${currentEnvironment.uvIndex}`,
            ]
              .filter(Boolean)
              .join('; ')
          : 'Recorded from the map. Weather and air-quality readings were unavailable.',
      };

      let error: {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      } | null = null;
      if (currentEnvironment) {
        const result = await client
          .from('inhaler_triggers')
          .insert(triggerData);
        error = result.error;
        if (error && isMissingTriggerWeatherColumn(error)) {
          const fallbackResult = await client.from('inhaler_triggers').insert({
            user_id: triggerData.user_id,
            latitude: triggerData.latitude,
            longitude: triggerData.longitude,
            aqi: triggerData.aqi,
            category: triggerData.category,
            pm25: triggerData.pm25,
            pm10: triggerData.pm10,
            temperature: triggerData.temperature,
            humidity: triggerData.humidity,
            notes: triggerData.notes,
          });
          error = fallbackResult.error;
        }
      } else {
        const result = await client.from('inhaler_triggers').insert({
          user_id: triggerData.user_id,
          latitude: triggerData.latitude,
          longitude: triggerData.longitude,
          aqi: triggerData.aqi,
          category: triggerData.category,
          pm25: triggerData.pm25,
          pm10: triggerData.pm10,
          temperature: triggerData.temperature,
          humidity: triggerData.humidity,
          notes: triggerData.notes,
        });
        error = result.error;
      }
      if (error) {
        throw new Error(
          `Could not save this trigger: ${getErrorMessage(
            error,
          )}${getTriggerLoadHint(error)}`,
        );
      }
      await loadTriggers();
      setTriggerMessage(
        currentEnvironment
          ? `Trigger recorded · AQI ${Math.round(currentEnvironment.aqi)} · ${
              currentEnvironment.temperature
            }°C`
          : 'Trigger recorded. Weather readings were unavailable.',
      );
    } catch (error) {
      setTriggerMessage(
        error instanceof Error
          ? error.message
          : 'Could not record this trigger. Try again.',
      );
    } finally {
      setRecordingTrigger(false);
    }
  }, [client, loadEnvironment, loadTriggers, user.id]);

  if (selectedTrigger) {
    return (
      <TriggerDetailScreen
        client={client}
        trigger={selectedTrigger}
        onBack={() => setSelectedTrigger(null)}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        showsUserLocation={hasLocationPermission}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        onRegionChangeComplete={setRegion}
        onMapReady={() => setMapReady(true)}
      >
        {safeZoneEnabled && deviceCoordinate && (
          <Circle
            center={deviceCoordinate}
            radius={250}
            strokeColor="rgba(38, 193, 145, 0.9)"
            fillColor="rgba(38, 193, 145, 0.18)"
            strokeWidth={2}
          />
        )}
        {deviceCoordinate && nearbyTriggerCount >= 5 && (
          <Circle
            center={deviceCoordinate}
            radius={200}
            strokeColor="rgba(239, 68, 68, 0)"
            fillColor="rgba(239, 68, 68, 0.22)"
            strokeWidth={0}
          />
        )}
        {deviceCoordinate &&
          nearbyTriggerCount < 5 &&
          nearbyYellowCount >= 3 &&
          nearbyYellowCount <= 4 && (
            <Circle
              center={deviceCoordinate}
              radius={100}
              strokeColor="rgba(245, 190, 45, 0)"
              fillColor="rgba(245, 190, 45, 0.2)"
              strokeWidth={0}
            />
          )}
        {triggers.map(trigger => (
          <Marker
            key={trigger.id}
            testID="trigger-marker"
            coordinate={{
              latitude: trigger.latitude,
              longitude: trigger.longitude,
            }}
            onPress={() => setSelectedTrigger(trigger)}
            tracksViewChanges={false}
          >
            <View
              style={[
                styles.triggerMarker,
                (trigger.aqi ?? 0) > 100 && styles.triggerMarkerWarning,
              ]}
            >
              <MaterialCommunityIcons name="lungs" color="#fff" size={25} />
            </View>
          </Marker>
        ))}
      </MapView>

      <View
        style={[
          styles.topBar,
          { height: insets.top + 58, paddingTop: insets.top + 4 },
        ]}
      >
        <Text style={styles.mapTitle}>Map</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bluetooth inhaler connection information"
          onPress={showBluetoothInfo}
          style={styles.bluetoothButton}
        >
          <MaterialCommunityIcons name="bluetooth" color="#eef2ff" size={24} />
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh inhaler count"
        onPress={loadCount}
        style={[styles.counter, { top: insets.top + 66 }]}
      >
        {countLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <MaterialCommunityIcons name="medical-bag" color="#fff" size={16} />
            <Text style={styles.counterText}>
              {count ? `${count.remaining_doses}/${count.total_doses}` : '—/—'}
            </Text>
          </>
        )}
      </Pressable>

      {!!countError && (
        <View style={styles.errorNotice}>
          <Text style={styles.errorText}>Count unavailable: {countError}</Text>
          <Pressable onPress={loadCount}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      {triggersError ? (
        <View
          style={[
            styles.triggerCountBadge,
            styles.triggerErrorBadge,
            { top: insets.top + 112 },
          ]}
        >
          <Text style={styles.redZoneText}>
            Couldn’t load map marks: {triggersError}
          </Text>
          <Pressable onPress={loadTriggers}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : triggersLoading ? (
        <View style={[styles.triggerCountBadge, { top: insets.top + 112 }]}>
          <ActivityIndicator color="#fff" size="small" />
          <Text style={styles.redZoneText}>Loading map marks</Text>
        </View>
      ) : nearbyTriggerCount >= 5 ? (
        <View style={[styles.redZoneBanner, { top: insets.top + 112 }]}>
          <MaterialCommunityIcons name="alert" color="#fff" size={18} />
          <Text style={styles.redZoneText}>
            RED ZONE · {nearbyTriggerCount} triggers within 200 m
          </Text>
        </View>
      ) : nearbyYellowCount >= 3 && nearbyYellowCount <= 4 ? (
        <View style={[styles.yellowZoneBanner, { top: insets.top + 112 }]}>
          <MaterialCommunityIcons name="alert" color="#fff" size={18} />
          <Text style={styles.redZoneText}>
            YELLOW ZONE · {nearbyYellowCount} triggers within 100 m
          </Text>
        </View>
      ) : null}
      {!!redZoneError && (
        <View
          style={[
            styles.triggerCountBadge,
            styles.triggerNotificationErrorBadge,
            { top: insets.top + 154 },
          ]}
        >
          <Text style={styles.redZoneText}>{redZoneError}</Text>
        </View>
      )}
      {!!signOutError && (
        <View style={[styles.locationNotice, { top: insets.top + 154 }]}>
          <Text style={styles.locationNoticeText}>{signOutError}</Text>
        </View>
      )}
      {!!locationMessage && (
        <View style={[styles.locationNotice, { top: insets.top + 154 }]}>
          <Text style={styles.locationNoticeText}>{locationMessage}</Text>
        </View>
      )}
      {!!triggerMessage && (
        <View style={[styles.triggerNotice, { top: insets.top + 154 }]}>
          <Text style={styles.locationNoticeText}>{triggerMessage}</Text>
        </View>
      )}

      {environmentOpen && (
        <View style={[styles.environmentCard, { top: insets.top + 112 }]}>
          <View style={styles.environmentHeader}>
            <View>
              <Text style={styles.environmentTitle}>Local conditions</Text>
              <Text style={styles.environmentCaption}>Open-Meteo · live</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close local conditions"
              onPress={() => setEnvironmentOpen(false)}
              hitSlop={10}
            >
              <Ionicons name="close" color="#c7d1e2" size={24} />
            </Pressable>
          </View>
          {environmentLoading ? (
            <ActivityIndicator
              color="#43d0ae"
              style={styles.environmentLoader}
            />
          ) : environmentError ? (
            <View>
              <Text style={styles.environmentError}>{environmentError}</Text>
              <Pressable onPress={() => loadEnvironment()}>
                <Text style={styles.environmentRetry}>Try again</Text>
              </Pressable>
            </View>
          ) : environment ? (
            <View style={styles.environmentMetrics}>
              <Metric
                label="Temperature"
                value={`${environment.temperature}°C`}
              />
              <Metric label="Humidity" value={`${environment.humidity}%`} />
              <Metric
                label="US AQI"
                value={`${Math.round(environment.aqi)} · ${getAqiCategory(
                  environment.aqi,
                )}`}
                highlight
              />
              <Metric label="PM2.5" value={`${environment.pm25} µg/m³`} />
              <Metric label="PM10" value={`${environment.pm10} µg/m³`} />
              {environment.uvIndex !== null && (
                <Metric label="Max UV today" value={`${environment.uvIndex}`} />
              )}
            </View>
          ) : (
            <Text style={styles.environmentError}>
              Location is needed to load conditions.
            </Text>
          )}
        </View>
      )}

      <View style={[styles.mapActions, { bottom: insets.bottom + 144 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show my location"
          onPress={locateAgain}
          style={[styles.actionButton, styles.locationButton]}
        >
          <MaterialCommunityIcons
            name="crosshairs-gps"
            color="#fff"
            size={25}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show local air quality and weather"
          onPress={() => {
            setEnvironmentOpen(!environmentOpen);
            if (!environmentOpen) {
              loadEnvironment();
            }
          }}
          style={[styles.actionButton, styles.airButton]}
        >
          <MaterialCommunityIcons name="air-filter" color="#fff" size={24} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            safeZoneEnabled
              ? 'Hide 250 meter safe zone'
              : 'Show 250 meter safe zone'
          }
          onPress={() => setSafeZoneEnabled(!safeZoneEnabled)}
          style={[
            styles.actionButton,
            styles.safeZoneButton,
            safeZoneEnabled && styles.safeZoneActive,
          ]}
        >
          <MaterialCommunityIcons name="shield-check" color="#fff" size={24} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Emergency SOS"
          disabled={sosBusy}
          onPress={() => openSos()}
          style={[styles.actionButton, styles.sosButton]}
        >
          {sosBusy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <MaterialCommunityIcons name="alert" color="#fff" size={20} />
              <Text style={styles.sosLabel}>SOS</Text>
            </>
          )}
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        testID="record-trigger"
        disabled={recordingTrigger}
        onPress={recordTrigger}
        style={[styles.recordButton, { bottom: insets.bottom + 76 }]}
      >
        <LinearGradient
          colors={['#39c9a7', '#4b9ef5']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.recordGradient}
        >
          {recordingTrigger ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="add-circle" color="#fff" size={22} />
              <Text style={styles.recordText}>Record Trigger</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>

      <View
        style={[
          styles.bottomBar,
          { height: insets.bottom + 64, paddingBottom: insets.bottom },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => setProfileOpen(false)}
          style={styles.tab}
        >
          <Ionicons
            name="map"
            size={21}
            style={[styles.tabIcon, !profileOpen && styles.activeTab]}
          />
          <Text style={[styles.tabLabel, !profileOpen && styles.activeTab]}>
            Map
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setProfileOpen(!profileOpen)}
          style={styles.tab}
        >
          <Ionicons
            name="person"
            size={21}
            style={[styles.tabIcon, profileOpen && styles.activeTab]}
          />
          <Text style={[styles.tabLabel, profileOpen && styles.activeTab]}>
            Profile
          </Text>
        </Pressable>
      </View>

      {profileOpen && (
        <View style={[styles.profileCard, { bottom: insets.bottom + 78 }]}>
          <Text style={styles.profileTitle}>
            {user.user_metadata.full_name || 'Your Profile'}
          </Text>
          <Text style={styles.profileEmail}>{user.email}</Text>
          <LinearGradient
            colors={['#39c9a7', '#4b9ef5']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.signOutGradient}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => signOut()}
              style={styles.signOutButton}
            >
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          </LinearGradient>
        </View>
      )}
    </View>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.environmentMetric}>
      <Text style={styles.environmentLabel}>{label}</Text>
      <Text
        numberOfLines={1}
        style={[
          styles.environmentValue,
          highlight && styles.environmentHighlight,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#e8edf2' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 16,
    backgroundColor: '#0b1020',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapTitle: { color: '#eef2ff', fontSize: 19, fontWeight: '700' },
  bluetoothButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff18',
    borderWidth: 1,
    borderColor: '#ffffff30',
  },
  counter: {
    position: 'absolute',
    right: 16,
    minWidth: 88,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: '#386de0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  counterText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  errorNotice: {
    position: 'absolute',
    top: 66,
    alignSelf: 'center',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: '#8f2f43',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorText: { color: '#fff', fontSize: 12 },
  retryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  locationNotice: {
    position: 'absolute',
    top: 116,
    alignSelf: 'center',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: '#172239dd',
  },
  locationNoticeText: { color: '#fff', fontSize: 12 },
  triggerNotice: {
    position: 'absolute',
    top: 116,
    alignSelf: 'center',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: '#172239dd',
  },
  mapActions: {
    position: 'absolute',
    right: 17,
    alignItems: 'center',
    gap: 10,
  },
  actionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ffffff88',
    elevation: 5,
    shadowColor: '#0b1020',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
  },
  locationButton: {
    backgroundColor: '#38cda7',
  },
  airButton: { backgroundColor: '#59677b' },
  safeZoneButton: { backgroundColor: '#22c78f' },
  safeZoneActive: {
    backgroundColor: '#087e64',
    borderColor: '#b6ffe8',
    borderWidth: 2,
  },
  sosButton: { backgroundColor: '#e34353', borderColor: '#ffd7d9' },
  sosLabel: { color: '#fff', fontSize: 9, fontWeight: '900', lineHeight: 11 },
  environmentCard: {
    position: 'absolute',
    left: 14,
    width: 242,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#101a2bee',
    borderWidth: 1,
    borderColor: '#ffffff35',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  environmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  environmentTitle: { color: '#f2f6ff', fontSize: 15, fontWeight: '700' },
  environmentCaption: { color: '#8fa0b9', fontSize: 11, marginTop: 2 },
  environmentLoader: { marginVertical: 18 },
  environmentError: { color: '#ffb9b9', fontSize: 12, lineHeight: 18 },
  environmentRetry: {
    color: '#55d6b7',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  environmentMetrics: { gap: 7 },
  environmentMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  environmentLabel: { color: '#aebbd0', fontSize: 12, flexShrink: 0 },
  environmentValue: {
    color: '#f2f6ff',
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  environmentHighlight: { color: '#5ce0bd' },
  triggerMarker: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#278c78',
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 4,
  },
  triggerMarkerWarning: { backgroundColor: '#d88724' },
  triggerCountBadge: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: '#172239ed',
  },
  triggerErrorBadge: { backgroundColor: '#8f2f43' },
  triggerNotificationErrorBadge: { backgroundColor: '#4b2632' },
  redZoneBanner: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#c72f42',
    borderWidth: 1,
    borderColor: '#ffd0d5',
    elevation: 6,
  },
  yellowZoneBanner: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#a66c08',
    borderWidth: 1,
    borderColor: '#ffe69a',
    elevation: 6,
  },
  redZoneText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  recordButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 78,
    overflow: 'hidden',
    borderRadius: 26,
    elevation: 4,
  },
  recordGradient: {
    minWidth: 194,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 18,
  },
  recordText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0b1020',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tab: { alignItems: 'center', justifyContent: 'center', width: '50%' },
  tabIcon: { color: '#8490a6', height: 25 },
  tabLabel: { color: '#8490a6', fontSize: 12 },
  activeTab: { color: '#39c9a7' },
  profileCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#111a2ef2',
    borderWidth: 1,
    borderColor: '#ffffff24',
  },
  profileTitle: { color: '#f1f5ff', fontSize: 18, fontWeight: '700' },
  profileEmail: {
    color: '#acb7ca',
    fontSize: 14,
    marginTop: 5,
    marginBottom: 16,
  },
  signOutGradient: { borderRadius: 22, overflow: 'hidden' },
  signOutButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
