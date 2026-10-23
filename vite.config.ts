import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // relative asset paths so the build runs from any folder or host
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] }, // keep the wasm loader untouched
  build: { target: 'es2022' },
});
