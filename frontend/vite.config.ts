import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The frontend calls the backend directly (VITE_API_BASE_URL, default
// http://localhost:8000/api); the backend allows this origin via CORS_ORIGINS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
});
