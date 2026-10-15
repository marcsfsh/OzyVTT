import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Rollup names a shared chunk, and the stylesheet split out with it, after one of its modules (React once
 * shipped as `api-*.js`). React and Socket.IO get chunks named for what they are; any other chunk shared
 * by several entries or lazy surfaces is `shared-*`, its stylesheet too. Entries and lazy surfaces keep
 * their own names.
 */
const VENDOR_CHUNKS: Record<string, RegExp> = {
  react: /\/node_modules\/(react|react-dom|scheduler)\//,
  socket:
    /\/node_modules\/(socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io\/component-emitter)\//
};
/**
 * Chunk names, recorded as Rollup names the chunk files, which it does before Vite emits their stylesheets.
 * An entry can share a name with a shared chunk (`index`), so a stylesheet is renamed only when no entry
 * has its name.
 */
const sharedChunkNames = new Set<string>();
const entryNames = new Set<string>();

export default defineConfig({
  plugins: [react()],
  build: {
    // Current phone and laptop browsers on the LAN. The stylesheets already need `:has()` and `dvh`,
    // which set this floor, so older syntax targets would only add weight.
    target: ["chrome111", "edge111", "firefox121", "safari16.4"],
    rollupOptions: {
      input: ["index.html", "viewer.html", "sheet.html"],
      output: {
        manualChunks: (id) => Object.keys(VENDOR_CHUNKS).find((name) => VENDOR_CHUNKS[name].test(id)),
        entryFileNames: (chunk) => {
          entryNames.add(chunk.name);
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: (chunk) => {
          if (chunk.isDynamicEntry || Object.hasOwn(VENDOR_CHUNKS, chunk.name)) return "assets/[name]-[hash].js";
          sharedChunkNames.add(chunk.name);
          return "assets/shared-[hash].js";
        },
        assetFileNames: (asset) => {
          const chunk = asset.names.find((name) => name.endsWith(".css"))?.replace(/\.css$/, "");
          return chunk && sharedChunkNames.has(chunk) && !entryNames.has(chunk)
            ? "assets/shared-[hash][extname]"
            : "assets/[name]-[hash][extname]";
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:3001", "/socket.io": { target: "ws://localhost:3001", ws: true } }
  }
});
