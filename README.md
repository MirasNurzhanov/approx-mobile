# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

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
