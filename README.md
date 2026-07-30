# Meye

Meye is a cross-platform personal productivity dashboard app designed to help you capture ideas, organize tasks, and sync data seamlessly. Built using modern web technologies, it features an offline-capable, lightning-fast voice dictation engine, daily/weekly task organization, calendar integration, and cross-device sync via GitHub Gists.

## Features

- **Offline Live Dictation**: Powered by a local WebAssembly port of Whisper (`whisper-tiny.en`), you can record your voice and get highly accurate transcriptions completely offline. 
- **Task Management**: Keep track of daily and weekly tasks effortlessly. Set reminders and track your progress throughout the week.
- **Calendar Integration**: Sync with Google Calendar to pull your upcoming events right into your daily view.
- **Cross-Device Sync**: Use GitHub Gists to sync your tasks and settings across your Mac and Android devices without needing a dedicated backend server.
- **Cross-Platform**: Available as a native macOS application (built with Electron) and an Android application (built with Capacitor).

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript (Vite for bundling)
- **Desktop (macOS)**: Electron
- **Mobile (Android)**: Capacitor
- **AI/ML**: Transformers.js (for running Whisper locally)
- **Integrations**: GitHub API (for Gist sync), Google Calendar API

## Getting Started

### Prerequisites

- Node.js (v18+)
- Java 21 (for Android build)
- Android Studio & Command Line Tools (for Android build)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/r69shabh/meye-app.git
   cd meye-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev:all
   ```

### Building for Production

#### macOS
```bash
npm run dist
```
This will generate a `.dmg` file in the `dist` directory.

#### Android
```bash
npm run build
npx cap sync android
cd android
./gradlew assembleRelease
```
The `.apk` file will be generated in `android/app/build/outputs/apk/release/`.

## License

This project is open-source and available under the MIT License.
