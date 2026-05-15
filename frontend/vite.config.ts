import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Silently install updates - new SW takes over on next page open (no popup, no reload prompt).
      // Matches the consumer-app pattern (Gmail, Spotify Web, etc.).
      registerType: "autoUpdate",

      // Off in dev so HMR isn't interfered with by cached responses.
      devOptions: { enabled: false },

      // App icons + display name shown on install / home-screen / dock.
      manifest: {
        name: "Bach to Basics",
        short_name: "Bach to Basics",
        description:
          "Browser-based piano practice tool - falling notes, sheet music, MIDI, and practice tools",
        theme_color: "#9333ea", // matches the purple accent
        background_color: "#0a0a0a",
        display: "standalone",
        orientation: "landscape-primary",
        start_url: "/",
        scope: "/",
        icons: [
          // Reuses existing public/ assets - logo.png is the high-res one,
          // apple-touch-icon and favicon are smaller fallbacks.
          {
            src: "/logo.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/logo.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
          },
          {
            src: "/favicon.png",
            sizes: "32x32",
            type: "image/png",
          },
        ],
      },

      workbox: {
        // Precache built static assets so the shell loads instantly + works offline.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],

        // Don't try to precache the soundfont folder (large; fetched lazily by AlphaTab).
        globIgnores: ["**/soundfont/**"],

        // Critical: NEVER cache backend API calls - we want fresh data, not a stale
        // cached response (e.g. old fingerings, old transcription results).
        navigateFallbackDenylist: [/^\/api/],

        // Runtime caching for cross-origin sample CDNs (smplr): serve fresh when online,
        // fall back to cache when offline so the on-screen piano still works.
        // Hosts: gleitz (Soundfont), smpldsnds (SplendidGrandPiano + ElectricPiano in 0.20+),
        // danigb (legacy, kept for older smplr versions).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(smpldsnds|gleitz|danigb)\.github\.io\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "smplr-samples",
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],

        // Bigger than the default 2 MiB so AlphaTab's bundle isn't rejected from precache.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "@bach-to-basics/shared": resolve(__dirname, "../shared/types/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@coderline/alphatab"],
    include: ["pixi.js"],
  },
});
