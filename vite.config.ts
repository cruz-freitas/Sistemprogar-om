import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { readFileSync } from "fs";
import { resolve } from "path";

// Gera versão baseada na data+hora do build: YYYYMMDD.HHMM
function buildVersion(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "." +
    pad(now.getHours()) +
    pad(now.getMinutes())
  );
}

const APP_VERSION = buildVersion();

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),

    // Plugin que substitui __APP_VERSION__ no sw.js após o build
    {
      name: "inject-sw-version",
      closeBundle() {
        const swPath = resolve(__dirname, "dist", "sw.js");
        try {
          let content = readFileSync(swPath, "utf-8");
          content = content.replace(/__APP_VERSION__/g, APP_VERSION);
          require("fs").writeFileSync(swPath, content, "utf-8");
          console.log(`[SW] Versão injetada: ${APP_VERSION}`);
        } catch (e) {
          console.warn("[SW] Não foi possível injetar versão:", e);
        }
      },
    },
  ],

  // Injeta __APP_VERSION__ no código React
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },

  build: {
    outDir: "dist",
  },
});
