import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      // web/src/diffFold.ts re-exports server/diffFold.ts (single fold source).
      allow: [".."],
    },
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
