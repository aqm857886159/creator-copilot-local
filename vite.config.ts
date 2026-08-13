import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Electron packaged builds load index.html through file://, so renderer
  // assets must resolve relative to the document instead of the host root.
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
});
