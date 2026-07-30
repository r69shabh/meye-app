import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['@xenova/transformers', 'onnxruntime-web']
  },
  plugins: [{
    name: 'log-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith('/models/')) {
          console.log(`[REQ] ${req.url}`);
        }
        next();
      });
    }
  }]
});
