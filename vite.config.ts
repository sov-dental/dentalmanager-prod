
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  logLevel: 'info',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Disable source maps to significantly reduce memory usage during build
    sourcemap: false,
    target: 'esnext',
    // Increase limit to handle larger chunks without noise
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Strategic chunking to prevent huge single files
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'recharts', 'lucide-react'],
          firebase: ['firebase/compat/app', 'firebase/compat/auth', 'firebase/compat/firestore', 'firebase/compat/storage'],
          utils: ['xlsx', 'exceljs', 'html2canvas', '@google/genai'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8080,
  }
});
