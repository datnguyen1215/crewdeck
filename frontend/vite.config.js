import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:9381";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 9380,
    proxy: {
      "/api": { target: backendUrl, timeout: 120000 },
      "/ws": { target: backendUrl, ws: true },
      "/terminal-ws": { target: backendUrl, ws: true },
    },
  },
});
