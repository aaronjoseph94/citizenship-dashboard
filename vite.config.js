import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the build works at a domain root (Cloudflare Workers) or under a sub-path.
export default defineConfig({ plugins: [react()], base: './' });
