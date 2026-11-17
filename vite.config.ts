import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The front end is the Genie site; the game API is a separate Genie background process.
const api = `http://127.0.0.1:${process.env.DRIFTHOLM_API_PORT ?? 4320}`;
const toApi = { target: api, xfwd: true };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1", // Genie's front door connects over IPv4; plain "localhost" may bind ::1 only
    strictPort: true,
    allowedHosts: [".gen"],
    proxy: { "/api": toApi, "/play.md": toApi },
  },
});
