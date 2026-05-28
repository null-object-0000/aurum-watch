import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "金哨 Aurum Watch",
        short_name: "金哨",
        description: "黄金行情与舆情影响预测",
        theme_color: "#050914",
        background_color: "#050914",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      workbox: {
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
        globPatterns: ["**/*.{js,css,html,svg,png}"]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": {
        target: "ws://localhost:8787",
        ws: true
      }
    }
  }
});
