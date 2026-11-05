import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
