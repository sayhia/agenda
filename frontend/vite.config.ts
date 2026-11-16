import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import wails from "@wailsio/runtime/plugins/vite";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  plugins: [vue(), wails("./bindings")],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/vue") || id.includes("node_modules/@vue")) {
            return "vendor-vue";
          }
          if (id.includes("node_modules/marked")) {
            return "vendor-marked";
          }
          if (id.includes("node_modules/@wailsio/runtime")) {
            return "vendor-wails";
          }
        },
      },
    },
  },
});
