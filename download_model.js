import { pipeline, env } from '@xenova/transformers';

// Configure transformers to save to our local directory
env.cacheDir = './public/models';
env.allowLocalModels = false;
env.allowRemoteModels = true;

async function run() {
  console.log("Downloading model to public/models...");
  // This will automatically download and cache the model in env.cacheDir
  const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
    quantized: true,
  });
  console.log("Download complete!");
}

run();
