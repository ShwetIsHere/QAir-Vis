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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, {
  Circle,
  Marker,
  PROVIDER_GOOGLE,
  type LatLng,
  type Region,
} from 'react-native-maps';
import type { SupabaseClient, User } from '@supabase/supabase-js';

type MapScreenProps = {
  client: SupabaseClient;
  user: User;
  onSignOut: () => Promise<void>;
};

type InhalerCount = {
  remaining_doses: number;
  total_doses: number;
};

type WeatherResponse = {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    precipitation: number;
    weathercode: number;
    cloudcover: number;
    pressure_msl: number;
    visibility: number;
    wind_speed_10m: number;
  };
  daily: {
    uv_index_max: number[];
  };
};

type AirQualityResponse = {
  current: {
    pm10: number;
    pm2_5: number;
    us_aqi: number;
  };
};

type Environment = {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  precipitation: number;
  weatherCode: number;
  cloudCover: number;
  pressure: number;
  visibility: number;
  windSpeed: number;
  uvIndex: number | null;
  aqi: number;
  pm25: number;
  pm10: number;
};

const defaultRegion: Region = {
  latitude: 22.3,
  longitude: 70.78,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

function getAqiCategory(aqi: number) {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

async function fetchEnvironment(
  latitude: number,
  longitude: number,
): Promise<Environment> {
  const coordinates = `latitude=${latitude}&longitude=${longitude}`;
  const [weatherResponse, airResponse] = await Promise.all([
    fetch(
      `https://api.open-meteo.com/v1/forecast?${coordinates}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weathercode,cloudcover,pressure_msl,visibility,wind_speed_10m&daily=uv_index_max&timezone=auto`,
    ),
    fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?${coordinates}&current=pm10,pm2_5,us_aqi&timezone=auto`,
    ),
  ]);

  if (!weatherResponse.ok) {
    throw new Error(`Weather service returned HTTP ${weatherResponse.status}.`);
  }
  if (!airResponse.ok) {
    throw new Error(
      `Air quality service returned HTTP ${airResponse.status}.`,
    );
  }

  const [weather, air] = await Promise.all([
    weatherResponse.json() as Promise<WeatherResponse>,
    airResponse.json() as Promise<AirQualityResponse>,
  ]);
  const values = [
    weather.current?.temperature_2m,
    weather.current?.apparent_temperature,
    weather.current?.relative_humidity_2m,
    weather.current?.precipitation,
    weather.current?.weathercode,
    weather.current?.cloudcover,
    weather.current?.pressure_msl,
    weather.current?.visibility,
    weather.current?.wind_speed_10m,
    air.current?.us_aqi,
    air.current?.pm2_5,
    air.current?.pm10,
  ];

  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Environmental services returned incomplete measurements.');
  }

  return {
    temperature: weather.current.temperature_2m,
    apparentTemperature: weather.current.apparent_temperature,
    humidity: weather.current.relative_humidity_2m,
    precipitation: weather.current.precipitation,
    weatherCode: weather.current.weathercode,
    cloudCover: weather.current.cloudcover,
    pressure: weather.current.pressure_msl,
    visibility: weather.current.visibility,
    windSpeed: weather.current.wind_speed_10m,
    uvIndex: weather.daily?.uv_index_max?.[0] ?? null,
    aqi: air.current.us_aqi,
    pm25: air.current.pm2_5,
    pm10: air.current.pm10,
  };
}

export default function MapScreen({
  client,
  user,
  onSignOut,
}: MapScreenProps) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState(defaultRegion);
  const [deviceCoordinate, setDeviceCoordinate] = useState<LatLng | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [count, setCount] = useState<InhalerCount | null>(null);
  const [countError, setCountError] = useState('');
  const [countLoading, setCountLoading] = useState(true);
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

  useEffect(() => {
    loadCount();
  }, [loadCount]);

  useEffect(() => {
    let active = true;

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
          accuracy: Location.Accuracy.Balanced,
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
        accuracy: Location.Accuracy.Balanced,
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
        error instanceof Error ? error.message : 'Could not sign out. Try again.',
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
      Alert.alert('Invalid phone number', 'The saved emergency number is invalid.');
      return;
    }

    Linking.openURL(`tel:${dialable}`).catch(() => {
      Alert.alert('Unable to call', 'Your device could not open the phone app.');
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
      if (!currentEnvironment) {
        throw new Error(
          'Weather or air-quality data is unavailable. Check your connection and retry.',
        );
      }

      const weatherNotes = [
        `Feels like ${currentEnvironment.apparentTemperature}°C`,
        `Precipitation ${currentEnvironment.precipitation} mm`,
        `Weather code ${currentEnvironment.weatherCode}`,
        `Cloud cover ${currentEnvironment.cloudCover}%`,
        `Pressure ${currentEnvironment.pressure} hPa`,
        `Visibility ${currentEnvironment.visibility} m`,
        `Wind ${currentEnvironment.windSpeed} km/h`,
        currentEnvironment.uvIndex === null
          ? null
          : `Daily max UV ${currentEnvironment.uvIndex}`,
      ]
        .filter(Boolean)
        .join('; ');

      const { error } = await client.from('inhaler_triggers').insert({
        user_id: user.id,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        aqi: Math.round(currentEnvironment.aqi),
        category: getAqiCategory(currentEnvironment.aqi),
        pm25: currentEnvironment.pm25,
        pm10: currentEnvironment.pm10,
        temperature: currentEnvironment.temperature,
        humidity: currentEnvironment.humidity,
        notes: `Recorded from the map. ${weatherNotes}`,
      });
      if (error) {
        throw error;
      }
      setTriggerMessage(
        `Trigger recorded · AQI ${Math.round(currentEnvironment.aqi)} · ${currentEnvironment.temperature}°C`,
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
  }, [client, loadEnvironment, user.id]);

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
        {deviceCoordinate && (
          <Marker coordinate={deviceCoordinate}>
            <View style={styles.userMarker}>
              <MaterialCommunityIcons
                name="heart-pulse"
                color="#fff"
                size={20}
              />
            </View>
          </Marker>
        )}
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
        <MaterialCommunityIcons
          name="bluetooth"
          color="#eef2ff"
          size={24}
        />
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
            <MaterialCommunityIcons
              name="medical-bag"
              color="#fff"
              size={16}
            />
            <Text style={styles.counterText}>
              {count
                ? `${count.remaining_doses}/${count.total_doses}`
                : '—/—'}
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
      {!!signOutError && (
        <View style={styles.locationNotice}>
          <Text style={styles.locationNoticeText}>{signOutError}</Text>
        </View>
      )}
      {!!locationMessage && (
        <View style={styles.locationNotice}>
          <Text style={styles.locationNoticeText}>{locationMessage}</Text>
        </View>
      )}
      {!!triggerMessage && (
        <View style={styles.triggerNotice}>
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
            <ActivityIndicator color="#43d0ae" style={styles.environmentLoader} />
          ) : environmentError ? (
            <View>
              <Text style={styles.environmentError}>{environmentError}</Text>
              <Pressable onPress={() => loadEnvironment()}>
                <Text style={styles.environmentRetry}>Try again</Text>
              </Pressable>
            </View>
          ) : environment ? (
            <View style={styles.environmentMetrics}>
              <Metric label="Temperature" value={`${environment.temperature}°C`} />
              <Metric label="Humidity" value={`${environment.humidity}%`} />
              <Metric
                label="US AQI"
                value={`${Math.round(environment.aqi)} · ${getAqiCategory(environment.aqi)}`}
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
            safeZoneEnabled ? 'Hide 250 meter safe zone' : 'Show 250 meter safe zone'
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
              <MaterialCommunityIcons
                name="alert"
                color="#fff"
                size={20}
              />
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
        <View
          style={[styles.profileCard, { bottom: insets.bottom + 78 }]}
        >
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
  userMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e75171',
    borderWidth: 2,
    borderColor: '#fff',
  },
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
  profileEmail: { color: '#acb7ca', fontSize: 14, marginTop: 5, marginBottom: 16 },
  signOutGradient: { borderRadius: 22, overflow: 'hidden' },
  signOutButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  signOutText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
