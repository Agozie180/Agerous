import { defineConfig } from 'vite';

// Social-preview crawlers need an absolute og:image URL. Set SITE_URL, or let Vercel's
// production URL be picked up automatically; otherwise fall back to a relative path.
const site = (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, '');
const ogImage = () => ({
  name: 'agerous-og-image',
  transformIndexHtml: html => html.replaceAll('__OG_IMAGE__', site ? `${site}/social.png` : 'social.png'),
});

export default defineConfig({
  base: './',
  plugins: [ogImage()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  // `npm run dev` + `node server/proxy.mjs` gives you the leaderboard, chat and LLM routes locally.
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8787', rewrite: p => p.replace(/^\/api/, '') } } },
});
