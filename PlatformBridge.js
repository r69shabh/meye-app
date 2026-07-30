import { Capacitor } from '@capacitor/core';
import { GoogleSignIn } from '@capawesome/capacitor-google-sign-in';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

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
  
  init() {
    if (Platform.OS === 'android') {
      App.addListener('appUrlOpen', async (data) => {
        if (data.url.includes('meye://oauth-callback')) {
          const url = new URL(data.url);
          const code = url.searchParams.get('code');
          if (code) {
            // Send the code to Vercel for token exchange
            try {
              const res = await fetch('https://meyee.vercel.app/api/github-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
              });
              const tokenData = await res.json();
              if (tokenData.access_token) {
                if (typeof I !== 'undefined') {
                  I.pat = tokenData.access_token;
                  I.syncToGitHub();
                }
              }
            } catch (err) {
              console.error("GitHub code exchange failed", err);
            }
          }
          Browser.close();
        }
      });
    }
  },

  Speech: {
    isSupported() {
      if (Platform.OS === 'web') {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      }
      if (Platform.OS === 'macos') {
        return !!window.electronAPI;
      }
      if (Platform.OS === 'android') {
        return true; 
      }
      return false;
    },

    async start(options = {}) {
      const { onResult, onEnd, onError, onStart } = options;

      if (Platform.OS === 'macos') {
        let mediaRecorder;
        let audioChunks = [];
        let audioContext;
        
        // Use a Worker to run Whisper without blocking the UI
        const worker = new Worker(new URL('./dictation-worker.js', import.meta.url), { type: 'module' });
        
        worker.onmessage = (e) => {
          const { type, text, error } = e.data;
          if (type === 'result') {
            onResult && onResult(text, '');
            onEnd && onEnd();
          } else if (type === 'interim_result') {
            onResult && onResult('', text);
          } else if (type === 'error') {
            onError && onError({ error });
            onEnd && onEnd();
          }
        };

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          
          // Instantly clear the UI timeout now that we have mic access
          onStart && onStart();
          
          worker.postMessage({ type: 'init' });

          audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          const source = audioContext.createMediaStreamSource(stream);

          // Real-time amplitude visualization
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          
          let animFrame;
          const reportAmplitude = () => {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            
            // Subtract small background noise floor so it stays flat when silent
            const noiseFloor = 5;
            const amplitude = Math.max(0.02, Math.min(1.0, (avg - noiseFloor) / 64.0)); 
            
            window.dispatchEvent(new CustomEvent('mic-amplitude', { detail: amplitude }));
            animFrame = requestAnimationFrame(reportAmplitude);
          };
          reportAmplitude();

          // Raw PCM Audio Capture
          const processor = audioContext.createScriptProcessor(4096, 1, 1);
          let audioBuffer = new Float32Array(0);
          let isRecording = true;

          processor.onaudioprocess = (e) => {
            if (!isRecording) return;
            const inputData = e.inputBuffer.getChannelData(0);
            
            const newBuffer = new Float32Array(audioBuffer.length + inputData.length);
            newBuffer.set(audioBuffer);
            newBuffer.set(inputData, audioBuffer.length);
            audioBuffer = newBuffer;
            
            // Silence output to prevent feedback
            const outputData = e.outputBuffer.getChannelData(0);
            for(let i = 0; i < outputData.length; i++) outputData[i] = 0;
          };

          source.connect(processor);
          processor.connect(audioContext.destination); // Needed for script processor to fire

          // Send interim transcripts every 1 second
          let interimInterval = setInterval(() => {
            if (audioBuffer.length > 16000) { // At least 1 second
              worker.postMessage({ type: 'transcribe_interim', audio: new Float32Array(audioBuffer) });
            }
          }, 1000);

          return {
            isMacNative: true,
            stop: () => {
              if (isRecording) {
                // Wait briefly to capture the tail end of the audio pipeline
                setTimeout(() => {
                  isRecording = false;
                  clearInterval(interimInterval);
                  cancelAnimationFrame(animFrame);
                  
                  processor.disconnect();
                  source.disconnect();
                  
                  worker.postMessage({ type: 'transcribe', audio: audioBuffer });
                  
                  stream.getTracks().forEach(t => t.stop());
                  if (audioContext.state !== 'closed') audioContext.close();
                }, 400);
              }
            }
          };
        } catch (err) {
          onError && onError({ error: err.message || 'Permission denied' });
          return null;
        }
      }

      if (Platform.OS === 'web') {
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
          await GoogleSignIn.initialize({
            clientId: clientId,
            scopes: [scope]
          });
          const result = await GoogleSignIn.signIn();
          
          if (result && result.accessToken) {
            await Platform.Storage.setSecure('meyeGCalToken', result.accessToken);
            if (typeof window.SettingsView !== 'undefined') {
              window.SettingsView.prefs.calSync = 'google';
              window.SettingsView.save();
              window.SettingsView.applyAll();
            }
            if (typeof window.SyncManager !== 'undefined') {
              window.SyncManager.fetchGoogleEvents();
            }
            alert("Google Calendar Connected via Native Sign-In!");
          }
        } catch (e) {
          console.error("Android Native OAuth error", e);
        }
      } else if (Platform.OS === 'macos') {
        try {
          const macClientId = 'YOUR_GOOGLE_CLIENT_ID';
          const macClientSecret = 'YOUR_GOOGLE_CLIENT_SECRET';
          const authUrlTemplate = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${macClientId}&redirect_uri=${encodeURIComponent('http://127.0.0.1:{PORT}/callback-data')}&response_type=code&scope=${encodeURIComponent(scope)}`;
          const tokenData = await window.electronAPI.startOAuthFlow(authUrlTemplate);
          
          if (tokenData && tokenData.code) {
            // Exchange code for token
            const res = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: macClientId,
                client_secret: macClientSecret,
                code: tokenData.code,
                grant_type: 'authorization_code',
                redirect_uri: `http://127.0.0.1:${tokenData._port}/callback-data`
              })
            });
            const actualTokenData = await res.json();
            
            if (actualTokenData.access_token) {
              await Platform.Storage.setSecure('meyeGCalToken', actualTokenData.access_token);
              if (typeof window.SettingsView !== 'undefined') {
                window.SettingsView.prefs.calSync = 'google';
                window.SettingsView.save();
                window.SettingsView.applyAll();
              }
              if (typeof window.SyncManager !== 'undefined') {
                window.SyncManager.fetchGoogleEvents();
              }
            }
          }
        } catch (e) {
          console.error("macOS Auth error", e);
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
        Browser.open({ url: authUrl + '?state=android' });
      } else if (Platform.OS === 'macos') {
        try {
          const authUrlTemplate = authUrl + '?state=electron:{PORT}';
          const tokenData = await window.electronAPI.startOAuthFlow(authUrlTemplate);
          if (tokenData && tokenData.code) {
            // Exchange code for token via Vercel
            const res = await fetch('https://meyee.vercel.app/api/github-auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: tokenData.code })
            });
            const actualTokenData = await res.json();
            if (actualTokenData.access_token && typeof window.SyncManager !== 'undefined') {
              window.SyncManager.pat = actualTokenData.access_token;
              window.SyncManager.syncToGitHub();
            }
          }
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
Platform.init();
