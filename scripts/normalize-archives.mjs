import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { zipSync } from "fflate";

import { archives } from "./archive-spec.mjs";

// Constructed in local time because ZIP stores calendar fields without a time zone.
const timestamp = new Date(1980, 0, 1);

for (const { extension, archive, files } of archives) {
  const outputDirectory = resolve("extensions", extension, "dist");
  const contents = {};

  for (const file of files) {
    contents[file] = readFileSync(resolve(outputDirectory, file));
  }

  const data = zipSync(contents, { level: 9, mtime: timestamp });
  writeFileSync(resolve(outputDirectory, archive), data);
}
