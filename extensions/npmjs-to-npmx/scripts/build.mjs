import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve("dist");
const staticPaths = ["manifest.json", "popup.html", "popup.css", "rules", "icons"];
const archiveFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "redirect.js",
  "settings.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "rules/packages.json",
  "rules/search.json",
  "rules/users.json",
  "rules/organizations.json",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
execFileSync("pnpm", ["exec", "tsc"], { stdio: "inherit" });

for (const path of staticPaths) {
  cpSync(path, resolve(outputDirectory, path), { recursive: true });
}

execFileSync("zip", ["-X", "npmjs-to-npmx.zip", ...archiveFiles], {
  cwd: outputDirectory,
  stdio: "inherit",
});
