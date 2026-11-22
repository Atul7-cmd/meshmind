import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite is only the build/dev tool that compiles JSX; it is not an app framework.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
