import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router'], vendor: ['@tanstack/react-query', 'react-hook-form', 'zod', '@hookform/resolvers', 'sonner', 'lucide-react'] } },
    },
  },
  server: {
    port: 5173,
    // Em desenvolvimento, a API responde na mesma origem — o cookie de sessão funciona sem CORS.
    proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:3000', changeOrigin: false } },
  },
});
