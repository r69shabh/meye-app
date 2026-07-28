# Meye native apps

This repository packages the existing Vite frontend as a Tauri 2 application for macOS and Android. The web UI, its `localStorage` data model, and the existing serverless backend are deliberately shared unchanged.

The current bundle identifier is `com.meyee.productivity`. Change it before release only if you own a different reverse-domain identifier; once an app is published, it must remain stable for updates.

## What is included

- `src-tauri/`: native application host and platform build configuration.
- `src-tauri/icons/`: macOS and Android icon assets generated from `public/icon.png`.
- `desktop:dev` and `desktop:build`: macOS development and release commands.
- `android:init`, `android:dev`, and `android:build`: Android setup and build commands.

## Prerequisites

Install these before building native binaries:

- Rust through [rustup](https://rustup.rs/), including the Android targets for Android builds.
- Xcode Command Line Tools on macOS.
- Android Studio, an Android SDK platform, SDK Build Tools, and a JDK 17 installation for Android builds.

The Android setup command creates platform-generated files under `src-tauri/gen/android/`; commit those files after the first successful initialization so Android configuration is reproducible.

## Development

```sh
npm install
npm run desktop:dev
```

The native shell starts the existing Vite app at port 1420. The normal browser workflow remains available with `npm run dev`.

## macOS release

```sh
npm run desktop:build
```

This creates an unsigned local macOS application. Before distributing it outside local testing, configure an Apple Developer signing identity and notarize the resulting app or DMG.

## Android setup and release

```sh
npm run android:init
npm run android:dev
npm run android:build
```

`android:build` produces debug output by default. Configure a release signing key and run the release build before submitting an AAB to Google Play.

## Required platform configuration before release

The visual app is ready to package, but these external settings are required for full feature parity:

1. Configure Android microphone and notification permissions in the generated Android manifest.
2. Add a macOS microphone usage description to the generated Xcode/Info.plist configuration.
3. Register Android and macOS OAuth redirect URLs for GitHub and Google Calendar. The current web OAuth flow relies on browser redirects and a relative `/api/github-auth` route; packaged apps must use the deployed HTTPS endpoint and a native deep-link callback.
4. Replace browser-timer reminders with OS-scheduled notifications if reminders must fire while the app is closed. This needs a small Tauri notification bridge, while leaving the backend and UI unchanged.

Do not place GitHub or Google client secrets in this repository or in the packaged application.
