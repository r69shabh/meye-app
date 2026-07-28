import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { OAuth2Client } from '@byteowls/capacitor-oauth2';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

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
        try {
          await SpeechRecognition.requestPermissions();
          
          if (onStart) onStart();
          
          SpeechRecognition.addListener('partialResults', (data) => {
            if (data.matches && data.matches.length > 0) {
              if (onResult) onResult('', data.matches[0]);
            }
          });

          SpeechRecognition.start({
            language: 'en-US',
            maxResults: 1,
            prompt: 'Listening...',
            partialResults: true,
            popup: false
          });

          // Capacitor Speech doesn't have a direct onEnd for `popup: false` that works cleanly,
          // so we'll listen for a stop event if the plugin fires one, or rely on our manual stop.
          return {
            isAndroidNative: true,
            stop: async () => {
              try {
                await SpeechRecognition.stop();
                await SpeechRecognition.removeAllListeners();
                if (onEnd) onEnd();
              } catch(e) {}
            }
          };

        } catch (e) {
          if (onError) onError(e);
          return null;
        }
      }
    },

    stop(recognitionObj) {
      if ((Platform.OS === 'web' || Platform.OS === 'macos') && recognitionObj) {
        recognitionObj.onresult = null;
        recognitionObj.onerror = null;
        recognitionObj.onend = null;
        try { recognitionObj.stop(); } catch(e) {}
      }
      if (Platform.OS === 'android' && recognitionObj?.isAndroidNative) {
        recognitionObj.stop();
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
        try {
          const oauth2Options = {
            appId: clientId,
            authorizationBaseUrl: "https://accounts.google.com/o/oauth2/auth",
            responseType: "token",
            scope: scope,
            redirectUrl: "com.meye.app:/oauth2redirect",
            customScheme: "com.meye.app"
          };
          
          const response = await OAuth2Client.authenticate(oauth2Options);
          
          if (response && response.access_token) {
            await Platform.Storage.setSecure('meyeGCalToken', response.access_token);
            if (typeof SettingsView !== 'undefined') {
              SettingsView.prefs.calSync = 'google';
              SettingsView.save();
              SettingsView.applyAll();
            }
            if (typeof SyncManager !== 'undefined') {
              SyncManager.fetchGoogleEvents();
            }
            alert("Google Calendar Connected via Android Custom Tabs!");
          }
        } catch (e) {
          console.error("Android OAuth error", e);
        }
      } else if (Platform.OS === 'macos') {
        try {
          // Open in system browser, passing state=electron
          const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://meyee.vercel.app/')}&response_type=token&scope=${encodeURIComponent(scope)}&state=electron`;
          window.electronAPI.openExternal(authUrl);
        } catch (e) {
          console.error("macOS OAuth error", e);
        }
      }
    },

    async authorizeGitHub() {
      const authUrl = 'https://meyee.vercel.app/api/github-auth';
      if (Platform.OS === 'web') {
        try {
          const a = document.createElement('a');
          a.href = authUrl;
          a.target = '_self';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } catch (e) {
          window.location.href = authUrl;
        }
      } else if (Platform.OS === 'android') {
        // Fallback for Android - use standard browser
        window.location.href = authUrl;
      } else if (Platform.OS === 'macos') {
        try {
          window.electronAPI.openExternal(authUrl + '?state=electron');
        } catch (e) {
          console.error("macOS GitHub Auth error", e);
        }
      }
    }
  },

  Storage: {
    async setSecure(key, val) {
      if (Platform.OS === 'web') {
        localStorage.setItem(key, val);
      } else if (Platform.OS === 'macos') {
        try {
          await window.electronAPI.setSecure(key, val);
        } catch(e) {
          localStorage.setItem(key, val); // fallback
        }
      } else if (Platform.OS === 'android') {
        try {
          await SecureStoragePlugin.set({ key, value: val });
        } catch(e) {
          localStorage.setItem(key, val); // fallback
        }
      }
    },

    async getSecure(key) {
      if (Platform.OS === 'web') {
        return localStorage.getItem(key);
      } else if (Platform.OS === 'macos') {
        try {
          return await window.electronAPI.getSecure(key);
        } catch(e) {
          return localStorage.getItem(key);
        }
      } else if (Platform.OS === 'android') {
        try {
          const res = await SecureStoragePlugin.get({ key });
          return res.value;
        } catch(e) {
          return localStorage.getItem(key);
        }
      }
    },
    
    async removeSecure(key) {
      if (Platform.OS === 'web') {
        localStorage.removeItem(key);
      } else if (Platform.OS === 'macos') {
        try {
          await window.electronAPI.removeSecure(key);
        } catch(e) {
          localStorage.removeItem(key);
        }
      } else if (Platform.OS === 'android') {
        try {
          await SecureStoragePlugin.remove({ key });
        } catch(e) {
          localStorage.removeItem(key);
        }
      }
    }
  }
};

window.Platform = Platform;
