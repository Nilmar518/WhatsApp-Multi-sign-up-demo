import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    react(),
    // Generates a self-signed cert stored in ~/.vite/basic-ssl.
    // Enables https://localhost:5173, which is required by Meta's Live Mode
    // for Facebook Login to work. Accept the browser cert warning once.
    basicSsl(),
  ],
  server: {
    port: 5173,
    proxy: {
      // Proxy /api/* → NestJS backend on 3001 (server-side, no HTTPS needed here)
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
