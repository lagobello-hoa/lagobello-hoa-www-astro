import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  output: "static",
  site: "https://lagohoa.org",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
