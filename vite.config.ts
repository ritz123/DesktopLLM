import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function appVersion() {
  try {
    return execSync("git describe --tags --abbrev=0", { encoding: "utf8" }).trim().replace(/^v/i, "");
  } catch {
    return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
  }
}

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: { outDir: "dist", emptyOutDir: false },
});
