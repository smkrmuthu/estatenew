import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "CEMMS Estate",
        short_name: "CEMMS",
        description: "Attendance, weigh-in and daily log for the estate",
        theme_color: "#3b2a1f",
        background_color: "#f6f1ea",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell only. API calls are never cached by the service worker; offline data lives in IndexedDB.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [],
      },
    }),
  ],
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  build: { sourcemap: true, target: "es2022" },
  test: { environment: "node", include: ["test/**/*.test.ts"], setupFiles: ["fake-indexeddb/auto"] },
});
