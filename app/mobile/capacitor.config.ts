import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cn.rainform.ultimate',
  appName: 'Rainform',
  webDir: 'www',
  bundledWebRuntime: false,
  loggingBehavior: 'none',
  // Android serves the WebView from https://localhost (secure context), which
  // keeps Geolocation, PWA APIs and mixed-content rules predictable.
  server: {
    androidScheme: 'https',
    // Uncomment while developing against a workstation running the gateway:
    // url: 'http://192.168.1.10:8787',
    // cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#03070d',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#03070d',
      overlaysWebView: true
    },
  },
  // iOS-specific build settings are applied by scripts/patch-ios.js
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
