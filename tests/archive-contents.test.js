import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { unzipSync } from "fflate";

import { archives } from "../scripts/archive-spec.js";

for (const { extension, archive, files } of archives) {
  test(`${archive} contains exactly the distributable files`, () => {
    const archivePath = resolve("extensions", extension, "dist", archive);
    const outputDirectory = resolve("extensions", extension, "dist");
    const contents = unzipSync(readFileSync(archivePath));

    assert.deepEqual(Object.keys(contents), files);
    for (const file of files) {
      assert.deepEqual(Buffer.from(contents[file]), readFileSync(resolve(outputDirectory, file)));
    }
  });
}
