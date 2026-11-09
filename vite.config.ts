/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;
const port = Number(process.env.ZOOCHATTR_DEV_PORT ?? 17420);

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // TWITCH_CLIENT_ID lives in .env (shared with the Rust build), so expose it to the UI as well.
  envPrefix: ["VITE_", "TWITCH_CLIENT_ID"],
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: port + 1 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // The bundle is embedded in the desktop binary and read from disk, so one chunk is fine.
  build: {
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests are pure functions; sharing workers across files cuts the run by a few seconds.
    isolate: false,
  },
}));
