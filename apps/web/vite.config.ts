import { defineConfig } from "vite";
import { aeoScoreApiPlugin } from "./vite.score-plugin.js";

export default defineConfig({
  root: ".",
  base: "./",
  plugins: [aeoScoreApiPlugin()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
