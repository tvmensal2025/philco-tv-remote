import { defineConfig } from 'vite';
import revideo from '@revideo/vite-plugin';

export default defineConfig({
  plugins: [revideo()],
  publicDir: 'public',
});
