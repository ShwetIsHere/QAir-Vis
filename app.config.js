const app = require('./app.json').expo;
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const mapsPlugin = googleMapsApiKey
  ? [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: googleMapsApiKey,
        iosGoogleMapsApiKey: googleMapsApiKey,
      },
    ]
  : null;

module.exports = ({ config }) => ({
  ...config,
  ...app,
  plugins: [
    ...(app.plugins ?? []),
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'QAir-Vis uses your location to show your position on the map.',
      },
    ],
    ...(mapsPlugin ? [mapsPlugin] : []),
  ],
});
