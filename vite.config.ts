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
      '@capacitor/app': path.resolve(__dirname, 'src/lib/capacitorApp.web.stub.ts'),
      '@capacitor/browser': path.resolve(__dirname, 'src/lib/capacitorBrowser.web.stub.ts'),
      '@capacitor-community/admob': path.resolve(__dirname, 'src/lib/capacitorAdmob.web.stub.ts'),
      '@capgo/native-purchases': path.resolve(__dirname, 'src/lib/capacitor.web.stub.ts'),
      [path.resolve(__dirname, 'src/lib/playBilling.ts')]: path.resolve(
        __dirname,
        'src/lib/playBilling.web.stub.ts'
      ),
      [path.resolve(__dirname, 'src/lib/admobService.ts')]: path.resolve(
        __dirname,
        'src/lib/admobService.web.stub.ts'
      ),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
