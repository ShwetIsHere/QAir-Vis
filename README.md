# QAir-Vis

QAir-Vis is an Expo app built with React Native and TypeScript.

## Supabase setup

The app reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from the root `.env` file. Never put a Supabase `service_role` or secret key in a mobile app. The public anon/publishable key is intended for clients and relies on row-level security.

After creating the tables from `supabase.sql`, run `supabase-rls.sql` once in the Supabase SQL Editor. It enables row-level security and limits each signed-in user to their own rows. The app creates a default inhaler-count row (30 doses) for a signed-in user only when that user has no count yet.

## Expo Go setup

Copy `.env.example` to `.env` only if you need a template; keep your existing `.env` values. Restart Expo after changing environment variables.

## Run with Expo Go

1. Install Node.js 22.11 or newer and the [Expo Go](https://expo.dev/go) app on your Android or iOS device.
2. From this project root, install dependencies and start Expo:

   ```sh
   npm install
   npx expo start
   ```

3. Scan the QR code shown in the terminal with Expo Go. Your phone and development computer should be on the same network. If the connection is blocked, run `npx expo start --tunnel`.

The installed Expo Go version must support this project's Expo SDK. If Expo Go reports an SDK mismatch, install the matching Expo Go version or update the project SDK.

The map uses `react-native-maps` and requests foreground location permission to center on your device. Its controls show a 250 m visual safe-zone radius, Open-Meteo weather and air-quality readings, and SOS calling for the primary emergency contact (or 112). Recording a trigger saves the GPS fix, AQI, PM2.5/PM10, temperature, humidity, and weather details to `inhaler_triggers`. Expo Go includes the map native module. `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is read by `app.config.js` for native builds; restrict that key to the Maps SDKs and your app identifiers in Google Cloud. Expo Go uses its own native map configuration.

The Bluetooth control is visible but explains that live device pairing needs a native development build; Expo Go does not include a Bluetooth Low Energy module.

## Checks

```sh
npm test
npm run lint
npx tsc --noEmit
```
