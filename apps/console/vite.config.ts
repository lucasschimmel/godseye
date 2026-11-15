import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { LOCAL_DEFAULTS } from "../../packages/contracts/src/config.ts";

const apiTarget = `http://${process.env.GODSEYE_API_HOST ?? LOCAL_DEFAULTS.host}:${process.env.GODSEYE_API_PORT ?? LOCAL_DEFAULTS.apiPort}`;
/** Server mode: the preview server only answers its owner hostname (and loopback for health). */
const ownerHost = process.env.GODSEYE_PUBLIC_ORIGIN
  ? new URL(process.env.GODSEYE_PUBLIC_ORIGIN).hostname
  : undefined;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss(), tanstackStart(), react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: LOCAL_DEFAULTS.host,
    port: Number(process.env.GODSEYE_CONSOLE_PORT ?? LOCAL_DEFAULTS.consolePort),
    strictPort: true,
    proxy: { "/api": apiTarget },
  },
  preview: {
    host: LOCAL_DEFAULTS.host,
    port: Number(process.env.GODSEYE_CONSOLE_PORT ?? LOCAL_DEFAULTS.consolePort),
    strictPort: true,
    allowedHosts: ownerHost ? [ownerHost, LOCAL_DEFAULTS.host] : [],
    proxy: { "/api": apiTarget },
  },
});
