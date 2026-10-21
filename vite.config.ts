import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Served at demos.fillorie.nl/email-triage/; keep in step with wrangler.jsonc and BASE in worker/index.ts.
  base: "/email-triage/",
  plugins: [react(), tailwindcss(), cloudflare()],
});
