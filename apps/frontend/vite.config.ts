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
  resolve: {
    // Force a single instance of Firebase packages so the component registry
    // is shared between firebase/app, firebase/auth, and firebase/firestore.
    // Without this, Vite's pre-bundler can split them into separate module
    // instances, causing "Component auth has not been registered yet".
    dedupe: ['firebase', '@firebase/app', '@firebase/auth'],
  },
  optimizeDeps: {
    include: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy /api/* → NestJS backend on 3001 (server-side, no HTTPS needed here)
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
