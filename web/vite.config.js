import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El dev server de Vite (5173) proxea /api y /health al backend (4000).
// Así el navegador habla con un único origen y las cookies de sesión
// funcionan sin configuración CORS adicional.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/health': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
