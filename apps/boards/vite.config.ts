import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4500;
const port = Number(process.env.BOARDS_PORT ?? DEFAULT_PORT);

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tanstackStart(), react()],

  server: { host: process.env.BOARDS_HOST ?? DEFAULT_HOST, port, strictPort: true },
  preview: { host: process.env.BOARDS_HOST ?? DEFAULT_HOST, port, strictPort: true },
});
