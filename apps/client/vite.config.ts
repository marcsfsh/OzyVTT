import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: ["index.html", "viewer.html", "styleguide.html"] } },
  server: { host: "0.0.0.0", port: 5173, strictPort: true, proxy: { "/api": "http://localhost:3001", "/socket.io": { target: "ws://localhost:3001", ws: true } } }
});
