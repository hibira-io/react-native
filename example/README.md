# Expo example

A live order feed, presence, a chunked catalogue and push notifications with
`@hibira-io/react-native`.

```sh
cp .env.example .env        # your app key, push instance ID and backend URL
npm install
npx expo run:ios            # or run:android; push needs a development build, not Expo Go
```

- Set `ios.bundleIdentifier` and `android.package` in `app.json` to your own.
- Android: put your Firebase project's `google-services.json` next to
  `app.json`, and upload the Firebase service account for that project in
  the Hibira portal (app page, Push notifications).
- iOS: upload your APNs key in the portal. Debug builds get development
  tokens, so set the instance's APNs environment to Development while you
  test on a device from Xcode.
- Your backend needs `/hibira/auth` for the presence channel; see the main
  README.
