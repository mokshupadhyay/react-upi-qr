import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = (file: string) => fileURLToPath(new URL(`../src/${file}`, import.meta.url));

// The example uses the library source directly, so edits show up without a
// build. `dedupe` keeps one copy of React: the example's.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react-upi-qr\/styles\.css$/, replacement: src('styles.css') },
      { find: /^react-upi-qr$/, replacement: src('index.ts') },
    ],
    dedupe: ['react', 'react-dom'],
  },
});
