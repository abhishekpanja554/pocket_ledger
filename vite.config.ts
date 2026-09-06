import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Plain static build. The old `@cloudflare/vite-plugin` also emitted a
// Workers SSR bundle (worker/index.ts) for the single-user Cloudflare Worker
// architecture — now retired in favor of a separate Spring Boot backend, so
// this app is just a client-side SPA with no server logic of its own.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
