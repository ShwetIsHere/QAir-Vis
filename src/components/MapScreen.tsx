import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import MapView, {
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

const defaultRegion: Region = {
  latitude: 22.3,
  longitude: 70.78,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

export default function MapScreen({
  client,
  user,
  onSignOut,
}: MapScreenProps) {
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

  const recordTrigger = useCallback(async () => {
    if (!hasLocationPermission) {
      setTriggerMessage('Allow location access before recording a trigger.');
      return;
    }

    setRecordingTrigger(true);
    setTriggerMessage('');
    try {
      const { error } = await client.from('inhaler_triggers').insert({
        user_id: user.id,
        latitude: region.latitude,
        longitude: region.longitude,
        notes: 'Recorded from the map',
      });
      if (error) {
        throw error;
      }
      setTriggerMessage('Trigger recorded.');
    } catch (error) {
      setTriggerMessage(
        error instanceof Error
          ? error.message
          : 'Could not record this trigger. Try again.',
      );
    } finally {
      setRecordingTrigger(false);
    }
  }, [client, hasLocationPermission, region, user.id]);

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
        {deviceCoordinate && (
          <Marker coordinate={deviceCoordinate}>
            <View style={styles.userMarker}>
              <Text style={styles.markerText}>♥</Text>
            </View>
          </Marker>
        )}
      </MapView>

      <View style={styles.topBar}>
        <Text style={styles.mapTitle}>Map</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh inhaler count"
          onPress={loadCount}
          style={styles.counter}
        >
          {countLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.counterIcon}>✚</Text>
              <Text style={styles.counterText}>
                {count
                  ? `${count.remaining_doses}/${count.total_doses}`
                  : '—/—'}
              </Text>
            </>
          )}
        </Pressable>
      </View>

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

      <View style={styles.mapActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show my location"
          onPress={locateAgain}
          style={styles.locationButton}
        >
          <Text style={styles.locationIcon}>◎</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={recordingTrigger}
        onPress={recordTrigger}
        style={styles.recordButton}
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
              <Text style={styles.recordPlus}>+</Text>
              <Text style={styles.recordText}>Record Trigger</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>

      <View style={styles.bottomBar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setProfileOpen(false)}
          style={styles.tab}
        >
          <Text style={[styles.tabIcon, !profileOpen && styles.activeTab]}>
            ◈
          </Text>
          <Text style={[styles.tabLabel, !profileOpen && styles.activeTab]}>
            Map
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setProfileOpen(!profileOpen)}
          style={styles.tab}
        >
          <Text style={[styles.tabIcon, profileOpen && styles.activeTab]}>
            ●
          </Text>
          <Text style={[styles.tabLabel, profileOpen && styles.activeTab]}>
            Profile
          </Text>
        </Pressable>
      </View>

      {profileOpen && (
        <View style={styles.profileCard}>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#e8edf2' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 58,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: '#0b1020',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapTitle: { color: '#eef2ff', fontSize: 19, fontWeight: '700' },
  counter: {
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
  counterIcon: { color: '#fff', fontSize: 16, fontWeight: '700' },
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
    top: 70,
    alignSelf: 'center',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: '#172239dd',
  },
  locationNoticeText: { color: '#fff', fontSize: 12 },
  triggerNotice: {
    position: 'absolute',
    top: 70,
    alignSelf: 'center',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: '#172239dd',
  },
  mapActions: {
    position: 'absolute',
    right: 17,
    bottom: 156,
    alignItems: 'center',
    gap: 10,
  },
  locationButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#38cda7',
    elevation: 4,
  },
  locationIcon: { color: '#fff', fontSize: 29, fontWeight: '700' },
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
  markerText: { color: '#fff', fontSize: 18 },
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
  recordPlus: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    color: '#39c9a7',
    backgroundColor: '#fff',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 22,
  },
  recordText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 67,
    backgroundColor: '#0b1020',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 8 : 0,
  },
  tab: { alignItems: 'center', justifyContent: 'center', width: '50%' },
  tabIcon: { color: '#8490a6', fontSize: 22, height: 25 },
  tabLabel: { color: '#8490a6', fontSize: 12 },
  activeTab: { color: '#39c9a7' },
  profileCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 84,
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
