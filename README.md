# QAir-Vis

QAir-Vis is an Expo app built with React Native and TypeScript.

## Run with Expo Go

1. Install Node.js 22.11 or newer and the [Expo Go](https://expo.dev/go) app on your Android or iOS device.
2. From this project root, install dependencies and start Expo:

   ```sh
   npm install
   npx expo start
   ```

3. Scan the QR code shown in the terminal with Expo Go. Your phone and development computer should be on the same network. If the connection is blocked, run `npx expo start --tunnel`.

The installed Expo Go version must support this project's Expo SDK. If Expo Go reports an SDK mismatch, install the matching Expo Go version or update the project SDK.

## Checks

```sh
npm test
npm run lint
npx tsc --noEmit
```
