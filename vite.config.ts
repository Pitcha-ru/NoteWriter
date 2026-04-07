import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: {
      input: "index.html",
    },
  },
});
