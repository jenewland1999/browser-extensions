import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { archives } from "./archive-spec.js";

const versionPart = "(?:0|[1-9]\\d*)";
const releaseTagPattern = new RegExp(
  `^v${versionPart}\\.${versionPart}\\.${versionPart}(?:-canary\\.${versionPart})?$`,
);
const chromeVersionPattern = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/;

export function validateReleaseMetadata({ tag, browserVersion, versionName }) {
  if (!releaseTagPattern.test(tag)) throw new Error(`Invalid release tag: ${tag}`);
  if (versionName !== tag.slice(1)) {
    throw new Error(`Version name ${versionName} does not match ${tag}.`);
  }
  if (!chromeVersionPattern.test(browserVersion)) {
    throw new Error(`Invalid Chrome version: ${browserVersion}`);
  }

  const parts = browserVersion.split(".").map(Number);
  if (parts.some((part) => part > 65_535) || parts.every((part) => part === 0)) {
    throw new Error(`Invalid Chrome version: ${browserVersion}`);
  }
}

export function releaseAssetName(archive, tag) {
  return `${basename(archive, ".zip")}-${tag}.zip`;
}

function parseArguments(arguments_) {
  if (arguments_[0] === "--") arguments_ = arguments_.slice(1);
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument list: ${arguments_.join(" ")}`);
    }
    options[name.slice(2).replaceAll("-", "_")] = value;
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const tag = options.tag;
  const browserVersion = options.browser_version;
  const versionName = options.version_name;
  const outputDirectory = resolve(options.output_directory ?? "release-assets");

  validateReleaseMetadata({ tag, browserVersion, versionName });
  mkdirSync(outputDirectory, { recursive: true });

  execFileSync("pnpm", ["run", "build"], { stdio: "inherit" });

  for (const { extension } of archives) {
    const manifestPath = resolve("extensions", extension, "dist", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.version = browserVersion;
    manifest.version_name = versionName;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  execFileSync(process.execPath, ["scripts/normalize-archives.js"], { stdio: "inherit" });

  const checksumLines = [];
  for (const { extension, archive } of archives) {
    const assetName = releaseAssetName(archive, tag);
    const source = resolve("extensions", extension, "dist", archive);
    const destination = resolve(outputDirectory, assetName);
    copyFileSync(source, destination);
    const checksum = createHash("sha256").update(readFileSync(destination)).digest("hex");
    checksumLines.push(`${checksum}  ${assetName}`);
  }

  checksumLines.sort();
  writeFileSync(resolve(outputDirectory, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
