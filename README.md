# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Sign in with Google / Apple

The buttons are on `app/login.tsx` and `app/register.tsx`; the flow lives in
`services/socialAuth.ts` and the server half in `users/socialauth.py` in the
backend repo. Neither library runs in Expo Go — **you need a dev build**, and a
new one after any of the config below changes.

A button whose credentials are missing is not rendered, so nothing breaks
before this is done — the buttons simply are not there.

### Google

1. In the Firebase console for `aura-96d48`, add OAuth clients for **Android**
   (needs the release *and* debug SHA-1 from `eas credentials`) and **iOS**,
   then re-download `google-services.json` into the repo root and
   `GoogleService-Info.plist` next to it.
2. Add `"googleServicesFile": "./GoogleService-Info.plist"` under `ios` in
   `app.json`. Android's is already wired.
3. Copy the **Web** client id from Google Cloud → Credentials into
   `expo.extra.googleAuth.webClientId` in `app.json`. This one is not optional
   on any platform: without it Google signs the user in and returns
   `idToken: null`, and the app reports "Google did not return a sign-in
   token".
4. Backend: set `GOOGLE_OAUTH_CLIENT_IDS` to all three ids, comma-separated.

### Apple

1. Enable the **Sign in with Apple** capability on the App ID in the Apple
   Developer portal. `app.json` already carries `ios.usesAppleSignIn` and the
   `expo-apple-authentication` plugin.
2. Backend: set `APPLE_SIGN_IN_CLIENT_IDS=com.arcanix.aura`.

iOS only, by design — Sign in with Apple on Android is a hosted web redirect
needing a Services ID, which is infrastructure rather than a flag.

### After a social sign-up

Neither provider shares a date of birth, so a newly created account is sent to
`app/social-birthday.tsx` before anything else. The 13+ floor is enforced
server-side on both routes into that field (register and profile PATCH).

## Saved passwords

The login and register fields carry both autofill contracts — `autoComplete`
(Android) and `textContentType` (iOS) — so the phone's own password manager
fills them and offers to save after a sign-in. Nothing needs configuring: this
works out of the box on both platforms, with iCloud Keychain, Google Password
Manager, or any third-party manager the user has set as the autofill service.

Passwords saved this way are scoped to the app. To have them shared with a
website of the same account, iOS additionally needs
`ios.associatedDomains: ["webcredentials:<domain>"]` and the matching
`apple-app-site-association` file served from that domain, and Android needs a
`assetlinks.json` with the app's signing fingerprint. Neither is set up,
because Approx has no web login to share credentials with yet.

## Hobby catalog (interests "Other" flow)

The "Other" option on the interest screens autocompletes against a bundled
catalog (`data/hobbies.json`, ~4,000 entries) and resolves free text via
`services/interestResolver.ts`. The catalog is **generated — don't edit it by
hand**:

```bash
npm run generate:hobbies   # regenerates data/hobbies.json + components/ui/hobbyIcons.generated.ts
npm test                   # resolver unit tests
```

Sources are committed snapshots of public Wikipedia lists plus the in-repo
seed — see `scripts/hobby-sources/SOURCES.md` for the list and how to refresh
them. The script normalizes/dedupes entries, assigns categories, aliases
(plurals, misspellings, common Russian variants), and a lucide icon per entry;
it **fails** if any icon name doesn't exist in the installed
`lucide-react-native`, so icon regressions can't slip through. Custom entries
that don't match the catalog are stored server-side with `needs_review=True`
(reviewable in the Django admin).

## Which backend a build talks to

`EXPO_PUBLIC_API_URL` sets the API address, validated in `services/apiUrl.ts`.
Switching backends never needs a source edit.

| Build | How to point it somewhere else | If unset |
|---|---|---|
| Local `npx expo start` | `EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-IP>:8000` in `.env.local` (gitignored). The Android emulator reaches your computer as `10.0.2.2`. | production |
| EAS `development` / `preview` | `"env": { "EXPO_PUBLIC_API_URL": "https://<staging-host>" }` on that profile in `eas.json` | production |
| EAS `production` | Already pinned to production in `eas.json`. | — |

The value is baked into the JavaScript bundle when it is built, so restart
Metro with `npx expo start --clear` after changing it, and an installed build
keeps the address it was built with.

A release build refuses plain `http` and local or private-network hosts at
launch; a development build accepts them. Keep local addresses in `.env.local`,
not `.env`: `.env` is not gitignored, and a committed file is uploaded with
every EAS build.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
