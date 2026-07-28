/**
 * PlatformBridge.js
 * 
 * An abstraction layer for native capabilities (Speech, Auth, Secure Storage)
 * that silently break inside webviews on Android/macOS.
 * 
 * Supports: Web (PWA), Android (Capacitor), macOS (Electron)
 */

const Platform = {
  get OS() {
    if (window.Capacitor && window.Capacitor.isNative) {
      return 'android'; // Or ios, but Capacitor is used for mobile
    }
    if (navigator.userAgent && navigator.userAgent.toLowerCase().includes('electron')) {
      return 'macos'; // Assuming Electron is used for macOS shell
    }
    return 'web';
  },

  Speech: {
    isSupported() {
      if (Platform.OS === 'web' || Platform.OS === 'macos') {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      }
      if (Platform.OS === 'android') {
        // Will implement via Capacitor community speech plugin
        return true; 
      }
      return false;
    },

    async start(options = {}) {
      const { onResult, onEnd, onError, onStart } = options;

      if (Platform.OS === 'web' || Platform.OS === 'macos') {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
          onError && onError({ error: 'not-supported' });
          return null;
        }

        const rec = new SR();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onaudiostart = () => onStart && onStart();
        rec.onresult = (event) => {
          let finalAddition = '';
          let interimText = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalAddition += t + ' ';
            } else {
              interimText = t;
            }
          }
          onResult && onResult(finalAddition, interimText);
        };

        rec.onerror = (e) => onError && onError(e);
        rec.onend = () => onEnd && onEnd();

        try {
          rec.start();
          return rec;
        } catch (e) {
          onError && onError(e);
          return null;
        }
      }

      if (Platform.OS === 'android') {
        // Placeholder: Will call Capacitor SpeechRecognition plugin
        console.warn('Android Speech bridge not implemented yet');
        return null;
      }
    },

    stop(recognitionObj) {
      if ((Platform.OS === 'web' || Platform.OS === 'macos') && recognitionObj) {
        recognitionObj.onresult = null;
        recognitionObj.onerror = null;
        recognitionObj.onend = null;
        try { recognitionObj.stop(); } catch(e) {}
      }
      if (Platform.OS === 'android') {
        // Placeholder: Stop Capacitor plugin
      }
    }
  },

  Auth: {
    async authorizeGoogleCalendar(clientId, scope) {
      if (Platform.OS === 'web') {
        const redirectUri = encodeURIComponent(window.location.origin);
        const encodedScope = encodeURIComponent(scope);
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=${encodedScope}`;
        window.location.href = authUrl;
      } else if (Platform.OS === 'android') {
        // Placeholder: Will use Capacitor Google Sign-In or OAuth Custom Tabs
        console.warn('Android Auth bridge not implemented yet');
      } else if (Platform.OS === 'macos') {
        // Placeholder: Will use Electron shell.openExternal + loopback
        console.warn('macOS Auth bridge not implemented yet');
      }
    }
  },

  Storage: {
    async setSecure(key, val) {
      if (Platform.OS === 'web') {
        localStorage.setItem(key, val);
      } else if (Platform.OS === 'android') {
        // Placeholder: Capacitor Secure Storage
        localStorage.setItem(key, val); // fallback for now
      } else if (Platform.OS === 'macos') {
        // Placeholder: Electron safeStorage via IPC
        localStorage.setItem(key, val); // fallback for now
      }
    },

    async getSecure(key) {
      if (Platform.OS === 'web') {
        return localStorage.getItem(key);
      } else if (Platform.OS === 'android') {
        // Placeholder: Capacitor Secure Storage
        return localStorage.getItem(key);
      } else if (Platform.OS === 'macos') {
        // Placeholder: Electron safeStorage via IPC
        return localStorage.getItem(key);
      }
    },
    
    async removeSecure(key) {
      if (Platform.OS === 'web') {
        localStorage.removeItem(key);
      } else if (Platform.OS === 'android') {
        localStorage.removeItem(key);
      } else if (Platform.OS === 'macos') {
        localStorage.removeItem(key);
      }
    }
  }
};

window.Platform = Platform;
