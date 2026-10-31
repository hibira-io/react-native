// The Android e2e app. Cleartext is on so it can reach the backend and the
// local server on the host (10.0.2.2). google-services.json, written by CI
// from a secret, turns on real FCM tokens.
const fs = require('node:fs');
const path = require('node:path');

const firebase = fs.existsSync(path.join(__dirname, 'google-services.json'));

module.exports = {
  expo: {
    name: 'Hibira E2E',
    slug: 'hibira-react-native-e2e',
    version: '1.0.0',
    android: {
      package: 'io.hibira.e2e',
      ...(firebase && { googleServicesFile: './google-services.json' }),
    },
    plugins: [['expo-build-properties', { android: { usesCleartextTraffic: true } }], 'expo-notifications'],
  },
};
