import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  // `npm run dev` + `node server/proxy.mjs` gives you the leaderboard, chat and LLM routes locally.
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8787', rewrite: p => p.replace(/^\/api/, '') } } },
});
