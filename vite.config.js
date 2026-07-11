import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Production build config.
//
// This generates a hashed, minified bundle and a precompiled service worker,
// which is what you want for the real home-screen deployment — the
// quickstart index.html in this folder (CDN Babel + Tailwind CDN) is for
// fast iteration only and should not be what you ship.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: ".",
      filename: "sw.js",
      injectManifest: { swSrc: "sw.js", swDest: "dist/sw.js" },
      manifest: false, // we ship our own manifest.json as-is
      includeAssets: ["icons/*.png"],
    }),
  ],
  server: { host: true, port: 5173 },
  build: { outDir: "dist", sourcemap: false },
});
