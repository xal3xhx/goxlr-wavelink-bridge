import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8")) as {
  version: string;
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve("electron/main.ts"),
      },
    },
    resolve: {
      alias: {
        "@shared": resolve("shared"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve("electron/preload.ts"),
      },
    },
    resolve: {
      alias: {
        "@shared": resolve("shared"),
      },
    },
  },
  renderer: {
    root: ".",
    plugins: [react(), tailwindcss()],
    define: {
      APP_VERSION: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@renderer": resolve("src"),
        "@shared": resolve("shared"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve("index.html"),
      },
    },
  },
});
