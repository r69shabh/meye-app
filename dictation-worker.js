import { pipeline, env } from '@xenova/transformers';

// Configure to exclusively use the packaged local models in the public folder
env.localModelPath = '/models/';
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false; // Bypass corrupted IndexedDB cache

let transcriberPromise = null;
let isProcessing = false;

self.onmessage = async (e) => {
  const { type, audio } = e.data;

  if (type === 'init') {
    if (!transcriberPromise) {
      transcriberPromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        quantized: true,
      });
    }
    try {
      await transcriberPromise;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message });
    }
  }

  if (type === 'transcribe_interim') {
    if (isProcessing || !transcriberPromise) return; // Skip if busy or not ready
    isProcessing = true;
    try {
      const transcriber = await transcriberPromise;
      const result = await transcriber(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'en',
        task: 'transcribe',
      });
      self.postMessage({ type: 'interim_result', text: result.text.trim() });
    } catch (err) {
      console.error('Interim transcribe error:', err);
    } finally {
      isProcessing = false;
    }
  }

  if (type === 'transcribe') {
    // Wait for any ongoing interim transcription to finish
    while (isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    isProcessing = true; // Block further interims
    try {
      if (!transcriberPromise) {
        throw new Error("Transcriber not initialized");
      }
      self.postMessage({ type: 'loading_model' }); // Optional tracking
      const transcriber = await transcriberPromise;
      
      const result = await transcriber(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'en',
        task: 'transcribe',
      });
      self.postMessage({ type: 'result', text: result.text.trim() });
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message });
    } finally {
      isProcessing = false;
    }
  }
};
