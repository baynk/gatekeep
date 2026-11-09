import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the static build works from any path (GitHub Pages, a
  // subfolder, any file server). Challenge links live entirely in the URL hash.
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4319, host: '127.0.0.1' },
});
