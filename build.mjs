// esbuild で main・preload・画面をまとめる
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const common = { bundle: true, sourcemap: true, logLevel: "warning", target: "es2022" };
mkdirSync("dist/renderer", { recursive: true });
await Promise.all([
  build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main/main.js", platform: "node", format: "cjs", external: ["electron", "electron-updater"] }),
  build({ ...common, entryPoints: ["src/main/preload.ts"], outfile: "dist/main/preload.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/renderer/app.ts"], outfile: "dist/renderer/app.js", platform: "browser", format: "iife" }),
]);
cpSync("src/renderer/index.html", "dist/renderer/index.html");
cpSync("src/renderer/style.css", "dist/renderer/style.css");
console.log("build ok");
