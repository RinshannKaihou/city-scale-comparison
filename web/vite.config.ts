import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Served from GitHub Pages at https://rinshannkaihou.github.io/city-scale-comparison/
  base: "/city-scale-comparison/",
  plugins: [react()],
  server: { port: 5174 },
});
