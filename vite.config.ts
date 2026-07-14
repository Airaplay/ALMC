import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __APP_TARGET__: JSON.stringify('web'),
  },
  plugins: [react()],
  base: './',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@capacitor/core': path.resolve(__dirname, 'src/lib/capacitor.web.stub.ts'),
      '@capacitor/preferences': path.resolve(__dirname, 'src/lib/capacitorPreferences.web.stub.ts'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
