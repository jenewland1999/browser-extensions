import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve("dist");
const archive = resolve(outputDirectory, "npmjs-to-npmx.zip");
const files = [
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

mkdirSync(outputDirectory, { recursive: true });
rmSync(archive, { force: true });
execFileSync("zip", ["-X", archive, ...files], {
  stdio: "inherit",
});
