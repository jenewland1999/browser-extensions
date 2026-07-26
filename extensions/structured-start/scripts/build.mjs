import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve("dist");
const staticPaths = ["manifest.json", "newtab.html", "newtab.css", "icons"];
const fonts = [
  ["@fontsource-variable/geist", "geist-latin-wght-normal.woff2"],
  ["@fontsource-variable/geist-mono", "geist-mono-latin-wght-normal.woff2"],
];
const archiveFiles = [
  "manifest.json",
  "newtab.html",
  "newtab.css",
  "newtab.js",
  "icons.js",
  "model.js",
  "emoji-data.json",
  "icons/icon.svg",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  ...fonts.map(([, font]) => `fonts/${font}`),
];

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(resolve(outputDirectory, "fonts"), { recursive: true });
execFileSync("pnpm", ["exec", "tsc"], { stdio: "inherit" });

for (const path of staticPaths) cpSync(path, resolve(outputDirectory, path), { recursive: true });
for (const [fontPackage, font] of fonts) {
  cpSync(
    resolve("node_modules", fontPackage, "files", font),
    resolve(outputDirectory, "fonts", font),
  );
}

const emojiGroups = JSON.parse(
  readFileSync(resolve("node_modules/unicode-emoji-json/data-by-group.json"), "utf8"),
);
writeFileSync(
  resolve(outputDirectory, "emoji-data.json"),
  JSON.stringify(
    emojiGroups.map(({ name, emojis }) => ({
      name,
      emojis: emojis.map(({ emoji, name: emojiName, skin_tone_support: tone }) => [
        emoji,
        emojiName,
        tone === true ? 1 : 0,
      ]),
    })),
  ),
);

execFileSync("zip", ["-X", "tessera.zip", ...archiveFiles], {
  cwd: outputDirectory,
  stdio: "inherit",
});
