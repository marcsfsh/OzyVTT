import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Current phone and laptop browsers on the LAN. The stylesheets already need `:has()` and `dvh`,
    // which set this floor, so older syntax targets would only add weight.
    target: ["chrome111", "edge111", "firefox121", "safari16.4"],
    rollupOptions: { input: ["index.html", "viewer.html", "sheet.html"] }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:3001", "/socket.io": { target: "ws://localhost:3001", ws: true } }
  }
});
