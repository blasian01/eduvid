import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Python server (port 8000) does the heavy lifting; Vite proxies API + media requests to it.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom", "remotion"] },
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/files": "http://127.0.0.1:8000",
    },
  },
});
