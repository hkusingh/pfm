// Pass at build time:
//   flutter run --dart-define=API_URL=https://pfm-api-production.up.railway.app
// Android emulator local dev: http://10.0.2.2:3000
// iOS simulator local dev:    http://localhost:3000
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');
