import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { LOCAL_DEFAULTS } from "../../packages/contracts/src/config.ts";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss(), tanstackStart(), react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: LOCAL_DEFAULTS.host,
    port: Number(process.env.GODSEYE_CONSOLE_PORT ?? LOCAL_DEFAULTS.consolePort),
    strictPort: true,
    proxy: {
      "/api": `http://${LOCAL_DEFAULTS.host}:${process.env.GODSEYE_API_PORT ?? LOCAL_DEFAULTS.apiPort}`,
    },
  },
});
