import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { createBookmarksHtml, createExportFilename } from "../dist/export.js";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));

test("build emits a loadable extension", async () => {
  const outputFiles = await readdir("dist");
  assert.ok(outputFiles.includes("popup.js"));
  assert.ok(outputFiles.includes("manifest.json"));
  assert.ok(outputFiles.includes("icons"));
  assert.ok(outputFiles.every((path) => !path.endsWith(".ts")));
});

test("requests only the APIs used by the exporter", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["downloads", "readingList"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.icons[128], "icons/icon-128.png");
});

test("creates Raindrop-compatible bookmark folders", () => {
  const html = createBookmarksHtml([
    {
      title: "Unread & useful",
      url: "https://example.com/?a=1&b=2",
      hasBeenRead: false,
      creationTime: 1_700_000_000_123,
    },
    {
      title: "Read <later>",
      url: "https://example.org/",
      hasBeenRead: true,
      creationTime: 1_600_000_000_999,
    },
  ]);

  assert.match(html, /<H3>Unread<\/H3>/);
  assert.match(html, /<H3>Read<\/H3>/);
  assert.match(html, /ADD_DATE="1700000000"/);
  assert.match(html, /READING_LIST_READ="false"/);
  assert.match(html, /READING_LIST_READ="true"/);
  assert.match(html, /Unread &amp; useful/);
  assert.match(html, /a=1&amp;b=2/);
  assert.match(html, /Read &lt;later&gt;/);
});

test("creates a dated export filename", () => {
  assert.equal(
    createExportFilename(new Date("2026-07-25T12:00:00.000Z")),
    "chrome-reading-list-2026-07-25.html",
  );
});
