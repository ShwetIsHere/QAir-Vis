import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEnvironment, getAqiCategory } from '../lib/environment';
import type { Environment } from '../lib/environment';
import type { TriggerRecord } from './MapScreen';

type Props = {
  client: SupabaseClient;
  trigger: TriggerRecord;
  onBack: () => void;
};

type FunctionErrorResponse = {
  status: number;
  clone: () => { json: () => Promise<unknown> };
};

function isFunctionErrorResponse(
  value: unknown,
): value is FunctionErrorResponse {
  if (!value || typeof value !== 'object') return false;
  return (
    'status' in value &&
    typeof value.status === 'number' &&
    'clone' in value &&
    typeof value.clone === 'function'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatLocation(place: Location.LocationGeocodedAddress | undefined) {
  if (!place) return 'Recorded location';
  return [place.city || place.subregion, place.region, place.country]
    .filter(Boolean)
    .join(', ');
}

function formatDate(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? 'Recorded trigger'
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

export default function TriggerDetailScreen({
  client,
  trigger,
  onBack,
}: Props) {
  const insets = useSafeAreaInsets();
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [place, setPlace] = useState('Recorded location');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [suggestionError, setSuggestionError] = useState('');
  const [suggestionLoading, setSuggestionLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');

    Promise.allSettled([
      fetchEnvironment(trigger.latitude, trigger.longitude),
      Location.reverseGeocodeAsync({
        latitude: trigger.latitude,
        longitude: trigger.longitude,
      }),
    ])
      .then(([environmentResult, locationResult]) => {
        if (!active) return;
        if (environmentResult.status === 'fulfilled') {
          setEnvironment(environmentResult.value);
        } else {
          setLoadError(
            environmentResult.reason instanceof Error
              ? environmentResult.reason.message
              : 'Could not load weather and air quality.',
          );
        }
        if (locationResult.status === 'fulfilled') {
          setPlace(formatLocation(locationResult.value[0]));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [trigger.latitude, trigger.longitude]);

  async function getSuggestion() {
    if (!environment) return;
    setSuggestionLoading(true);
    setSuggestionError('');
    setSuggestion('');
    try {
      const { data, error } = await client.functions.invoke(
        'weather-suggestion',
        {
          body: {
            environment,
          },
        },
      );
      if (error) throw error;
      if (typeof data?.suggestion !== 'string' || !data.suggestion.trim()) {
        throw new Error('The suggestion service returned an empty response.');
      }
      setSuggestion(data.suggestion.trim());
    } catch (error) {
      let message =
        error instanceof Error
          ? error.message
          : 'Could not load a suggestion. Try again later.';
      const context =
        error && typeof error === 'object' && 'context' in error
          ? error.context
          : undefined;
      if (isFunctionErrorResponse(context)) {
        try {
          const responseBody = await context.clone().json();
          if (
            isRecord(responseBody) &&
            typeof responseBody.error === 'string'
          ) {
            message = responseBody.error;
          } else if (
            isRecord(responseBody) &&
            typeof responseBody.message === 'string'
          ) {
            message = responseBody.message;
          }
          if (
            isRecord(responseBody) &&
            typeof responseBody.details === 'string'
          ) {
            message = `${message} (${responseBody.details})`;
          }
        } catch {
          message = `${message} (HTTP ${context.status})`;
        }
      }
      setSuggestionError(message);
    } finally {
      setSuggestionLoading(false);
    }
  }

  const aqi = environment?.aqi ?? trigger.aqi;
  const aqiCategory =
    aqi === null ? trigger.category || 'Unavailable' : getAqiCategory(aqi);
  const wind180m = trigger.wind_speed_180m ?? environment?.windSpeed180m;
  const showers = trigger.showers ?? environment?.showers;
  const precipitationNextHour =
    trigger.precipitation_next_hour ?? environment?.precipitationNextHour;
  const showersNextHour =
    trigger.showers_next_hour ?? environment?.showersNextHour;
  const dewPoint = trigger.dew_point_2m ?? environment?.dewPoint;
  const surfacePressure =
    trigger.surface_pressure ?? environment?.surfacePressure;
  const pressureMsl = trigger.pressure_msl ?? environment?.pressure;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to map"
          onPress={onBack}
          hitSlop={12}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={23} color="#f4f6fb" />
        </Pressable>
        <Text style={styles.headerTitle}>Location Weather</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.locationBlock}>
          <Text style={styles.time}>{formatDate(trigger.timestamp)}</Text>
          <View style={styles.addressRow}>
            <Ionicons name="location" size={25} color="#fff" />
            <Text style={styles.address}>{place}</Text>
          </View>
          <Text style={styles.coordinates}>
            {trigger.latitude.toFixed(5)}, {trigger.longitude.toFixed(5)}
          </Text>
        </View>

        <LinearGradient
          colors={['#5ca5f5', '#4b89d4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.weatherCard}
        >
          <View style={styles.weatherTop}>
            <View style={styles.temperatureBlock}>
              <MaterialCommunityIcons
                name="weather-partly-cloudy"
                color="#fff"
                size={46}
              />
              <Text style={styles.temperature}>
                {loading
                  ? '—'
                  : environment
                  ? `${Math.round(environment.temperature)}°C`
                  : trigger.temperature === null
                  ? '—'
                  : `${Math.round(trigger.temperature)}°C`}
              </Text>
              <Text style={styles.feelsLike}>
                {environment
                  ? `Feels like ${Math.round(
                      environment.apparentTemperature,
                    )}°C`
                  : loadError || 'Weather unavailable'}
              </Text>
              <Text style={styles.weatherCondition}>
                {environment
                  ? `Weather code ${environment.weatherCode}`
                  : 'Recorded trigger conditions'}
              </Text>
            </View>
            <View style={styles.aqiBadge}>
              <Text style={styles.aqiCaption}>AQI</Text>
              <Text style={styles.aqiValue}>
                {aqi === null ? '—' : Math.round(aqi)}
              </Text>
              <Text style={styles.aqiCategory}>{aqiCategory}</Text>
            </View>
          </View>

          {loading && (
            <ActivityIndicator color="#fff" style={styles.loadingIndicator} />
          )}
          {loadError ? (
            <Text style={styles.weatherError}>{loadError}</Text>
          ) : null}
          <View style={styles.metricGrid}>
            <Metric
              icon="water-percent"
              label="Humidity"
              value={
                environment
                  ? `${Math.round(environment.humidity)}%`
                  : trigger.humidity === null
                  ? '—'
                  : `${Math.round(trigger.humidity)}%`
              }
            />
            <Metric
              icon="weather-windy"
              label="Wind (180 m)"
              value={wind180m === undefined ? '—' : `${wind180m} km/h`}
            />
            <Metric
              icon="weather-rainy"
              label="Showers"
              value={showers === undefined ? '—' : `${showers} mm`}
            />
            <Metric
              icon="weather-cloudy"
              label="Cloud cover"
              value={environment ? `${environment.cloudCover}%` : '—'}
            />
            <Metric
              icon="white-balance-sunny"
              label="UV index"
              value={
                environment?.uvIndex === null || !environment
                  ? '—'
                  : `${environment.uvIndex}`
              }
            />
            <Metric
              icon="eye-outline"
              label="Visibility"
              value={
                environment
                  ? `${(environment.visibility / 1000).toFixed(1)} km`
                  : '—'
              }
            />
          </View>
        </LinearGradient>

        <View style={styles.airCard}>
          <Text style={styles.sectionTitle}>Additional Information</Text>
          <View style={styles.additionalMetrics}>
            <AdditionalInfo
              label="Surface Pressure"
              value={
                surfacePressure === undefined ? '—' : `${surfacePressure} hPa`
              }
            />
            <AdditionalInfo
              label="Pressure (MSL)"
              value={pressureMsl === undefined ? '—' : `${pressureMsl} hPa`}
            />
            <AdditionalInfo
              label="Dew Point"
              value={dewPoint === undefined ? '—' : `${dewPoint}°C`}
            />
            <AdditionalInfo
              label="Precipitation"
              value={environment ? `${environment.precipitation} mm` : '—'}
            />
            <AdditionalInfo
              label="Coordinates"
              value={`${trigger.latitude.toFixed(
                4,
              )}, ${trigger.longitude.toFixed(4)}`}
            />
          </View>
          {precipitationNextHour === 0 && showersNextHour === 0 && (
            <View style={styles.noRainBanner}>
              <MaterialCommunityIcons
                name="check-circle"
                size={18}
                color="#37dfa0"
              />
              <Text style={styles.noRainText}>
                No precipitation within an hour
              </Text>
            </View>
          )}
        </View>

        <View style={styles.airCard}>
          <Text style={styles.sectionTitle}>Air Quality Details</Text>
          <View style={styles.airMetrics}>
            <Metric
              icon="blur"
              label="PM2.5"
              value={
                environment
                  ? `${environment.pm25} µg/m³`
                  : trigger.pm25 === null
                  ? '—'
                  : `${trigger.pm25} µg/m³`
              }
              dark
            />
            <Metric
              icon="blur"
              label="PM10"
              value={
                environment
                  ? `${environment.pm10} µg/m³`
                  : trigger.pm10 === null
                  ? '—'
                  : `${trigger.pm10} µg/m³`
              }
              dark
            />
            <Metric
              icon="gauge"
              label="US AQI"
              value={aqi === null ? '—' : `${Math.round(aqi)}`}
              dark
            />
          </View>
        </View>

        <View style={styles.suggestionCard}>
          <View style={styles.suggestionHeading}>
            <MaterialCommunityIcons
              name="lightbulb-on-outline"
              size={22}
              color="#55d6b7"
            />
            <Text style={styles.sectionTitle}>Personalized suggestion</Text>
          </View>
          <Text style={styles.suggestionDisclaimer}>
            General environmental guidance, not a medical diagnosis.
          </Text>
          {suggestion ? (
            <Text style={styles.suggestionText}>{suggestion}</Text>
          ) : suggestionError ? (
            <Text style={styles.suggestionError}>{suggestionError}</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Get environmental care suggestion"
              disabled={!environment || loading || suggestionLoading}
              onPress={() => getSuggestion()}
              style={[
                styles.suggestionButton,
                (!environment || loading || suggestionLoading) &&
                  styles.buttonDisabled,
              ]}
            >
              <LinearGradient
                colors={['#39c9a7', '#4b9ef5']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.suggestionGradient}
              >
                {suggestionLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.suggestionButtonText}>
                    Get suggestion
                  </Text>
                )}
              </LinearGradient>
            </Pressable>
          )}
          {(suggestion || suggestionError) && (
            <Pressable onPress={() => getSuggestion()}>
              <Text style={styles.retrySuggestion}>Refresh suggestion</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function AdditionalInfo({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.additionalInfoRow}>
      <Text style={styles.additionalInfoLabel}>{label}</Text>
      <Text style={styles.additionalInfoValue}>{value}</Text>
    </View>
  );
}

function Metric({
  icon,
  label,
  value,
  dark = false,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
  dark?: boolean;
}) {
  return (
    <View style={[styles.metric, dark && styles.darkMetric]}>
      <MaterialCommunityIcons name={icon} color="#fff" size={21} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d1424' },
  header: {
    minHeight: 54,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#0b1020',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  headerTitle: { color: '#edf2ff', fontSize: 19, fontWeight: '700' },
  headerSpacer: { width: 36 },
  content: { paddingBottom: 28 },
  locationBlock: {
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: '#202838',
    borderBottomWidth: 1,
    borderBottomColor: '#667085',
  },
  time: { color: '#c4cad6', fontSize: 16, marginBottom: 12 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  address: { color: '#f5f7fb', fontSize: 22, fontWeight: '700', flexShrink: 1 },
  coordinates: { color: '#aab4c4', fontSize: 12, marginTop: 8, marginLeft: 35 },
  weatherCard: { margin: 16, padding: 20, minHeight: 430 },
  weatherTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  temperatureBlock: { flex: 1, paddingRight: 8 },
  temperature: { color: '#fff', fontSize: 56, fontWeight: '300', marginTop: 8 },
  feelsLike: { color: '#eef5ff', fontSize: 17, marginTop: 2 },
  weatherCondition: { color: '#e5efff', fontSize: 15, marginTop: 6 },
  aqiBadge: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    minWidth: 102,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#ffffff35',
  },
  aqiCaption: { color: '#fff', fontSize: 14 },
  aqiValue: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
    marginVertical: 2,
  },
  aqiCategory: { color: '#f4f8ff', fontSize: 12 },
  loadingIndicator: { marginVertical: 16 },
  weatherError: { color: '#fff', fontSize: 13, marginBottom: 16 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: {
    width: '48%',
    minHeight: 94,
    flexGrow: 1,
    flexBasis: '45%',
    padding: 13,
    borderRadius: 16,
    backgroundColor: '#ffffff38',
  },
  darkMetric: {
    backgroundColor: '#ffffff10',
    borderWidth: 1,
    borderColor: '#ffffff1a',
  },
  metricLabel: { color: '#edf4ff', fontSize: 13, marginTop: 8 },
  metricValue: { color: '#fff', fontSize: 19, fontWeight: '700', marginTop: 2 },
  airCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#273346',
    borderWidth: 1,
    borderColor: '#ffffff30',
  },
  additionalMetrics: { marginTop: 8 },
  additionalInfoRow: {
    minHeight: 41,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff15',
    gap: 12,
  },
  additionalInfoLabel: { color: '#bfc8d6', fontSize: 14, flexShrink: 1 },
  additionalInfoValue: {
    color: '#f4f6fb',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  noRainBanner: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#164e4a',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  noRainText: { color: '#c4ffe7', fontSize: 13, fontWeight: '600' },
  sectionTitle: { color: '#edf2ff', fontSize: 19, fontWeight: '700' },
  airMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  suggestionCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#202b3d',
    borderWidth: 1,
    borderColor: '#ffffff24',
  },
  suggestionHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  suggestionDisclaimer: { color: '#aeb8c9', fontSize: 12, marginTop: 8 },
  suggestionText: {
    color: '#eef2fa',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 14,
  },
  suggestionError: { color: '#ffb9b9', fontSize: 13, marginTop: 14 },
  suggestionButton: { overflow: 'hidden', borderRadius: 24, marginTop: 16 },
  buttonDisabled: { opacity: 0.55 },
  suggestionGradient: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  retrySuggestion: {
    color: '#5ce0bd',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12,
  },
});
