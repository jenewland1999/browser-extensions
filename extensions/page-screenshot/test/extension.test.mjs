import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCaptureTabUnchanged,
  CaptureLock,
  captureWithVerification,
  createCaptureTiles,
  createFilename,
  normalizeSettings,
  validateCanvasDimensions,
  validatePageMetrics,
} from "../dist/capture.js";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));

test("build emits loadable extension files", async () => {
  const outputFiles = await readdir("dist", { recursive: true });
  assert.ok(outputFiles.includes("popup.js"));
  assert.ok(outputFiles.includes("manifest.json"));
  assert.ok(outputFiles.every((path) => !path.endsWith(".ts")));
});

test("uses only screenshot permissions", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "downloads", "scripting", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background.service_worker, "background.js");
});

test("creates full-page tiles including partial edges", () => {
  const tiles = createCaptureTiles({
    width: 1000,
    height: 1500,
    viewportWidth: 1000,
    viewportHeight: 700,
    scrollX: 0,
    scrollY: 0,
  });
  assert.deepEqual(
    tiles.map(({ y, height, scrollY, sourceY }) => ({ y, height, scrollY, sourceY })),
    [
      { y: 0, height: 700, scrollY: 0, sourceY: 0 },
      { y: 700, height: 700, scrollY: 700, sourceY: 0 },
      { y: 1400, height: 100, scrollY: 800, sourceY: 600 },
    ],
  );
});

test("rejects invalid page metrics before creating tiles", () => {
  const metrics = {
    width: 1000,
    height: 1500,
    viewportWidth: 0,
    viewportHeight: 700,
    scrollX: 0,
    scrollY: 0,
  };
  assert.throws(() => validatePageMetrics(metrics), /Invalid viewport width/);
  assert.throws(() => createCaptureTiles(metrics), /Invalid viewport width/);
});

test("enforces canvas dimensions and estimated memory limits", () => {
  const limits = { maxCanvasDimension: 10_000, maxCanvasBytes: 400 };
  assert.equal(validateCanvasDimensions(10, 10, limits), 400);
  assert.throws(() => validateCanvasDimensions(10_001, 1, limits), /dimension must be 10000px/);
  assert.throws(() => validateCanvasDimensions(11, 10, limits), /canvas memory limit/);
  assert.throws(() => validateCanvasDimensions(Number.NaN, 10, limits), /Invalid screenshot/);
});

test("capture lock permits only one operation until released", () => {
  const lock = new CaptureLock();
  const release = lock.tryAcquire();
  assert.equal(typeof release, "function");
  assert.equal(lock.tryAcquire(), undefined);
  release();
  release();
  assert.equal(typeof lock.tryAcquire(), "function");
});

test("detects active tab, window, and URL changes", () => {
  const original = { id: 1, windowId: 2, url: "https://example.com/page", active: true };
  assert.doesNotThrow(() => assertCaptureTabUnchanged(original, { ...original }));
  assert.throws(
    () => assertCaptureTabUnchanged(original, { ...original, active: false }),
    /not active/,
  );
  assert.throws(
    () => assertCaptureTabUnchanged(original, { ...original, windowId: 3 }),
    /changed windows/,
  );
  assert.throws(
    () => assertCaptureTabUnchanged(original, { ...original, url: "https://example.com/next" }),
    /URL changed/,
  );
});

test("verifies immediately before and after capturing data", async () => {
  const events = [];
  const result = await captureWithVerification(
    async () => events.push("verify"),
    async () => {
      events.push("capture");
      return "captured-data";
    },
  );
  assert.equal(result, "captured-data");
  assert.deepEqual(events, ["verify", "capture", "verify"]);
});

test("rejects captured data when post-capture verification fails", async () => {
  let verification = 0;
  await assert.rejects(
    captureWithVerification(
      async () => {
        verification += 1;
        if (verification === 2) throw new Error("tab changed");
      },
      async () => "untrusted-captured-data",
    ),
    /tab changed/,
  );
});

test("creates timestamped screenshot path", () => {
  assert.equal(
    createFilename(new Date(2026, 6, 25, 9, 8, 7), "png", "www.elanco.com", "viewport"),
    "elanco.com_viewport_2026-07-25_09-08-07.png",
  );
  assert.equal(
    createFilename(new Date(2026, 6, 25, 9, 8, 7), "jpeg", "docs.example.com", "full-page"),
    "docs.example.com_full-page_2026-07-25_09-08-07.jpg",
  );
  assert.equal(createFilename(new Date(2026, 6, 25, 9, 8, 7), "webp").endsWith(".webp"), true);
  assert.equal(
    createFilename(
      new Date(2026, 6, 25, 9, 8, 7),
      "png",
      "www.elanco.com",
      "full-page",
      "%date%--%domain%--%type%",
    ),
    "2026-07-25--elanco.com--full-page.png",
  );
});

test("normalizes screenshot settings", () => {
  assert.deepEqual(normalizeSettings({ format: "jpeg", quality: 120, askWhereToSave: true }), {
    format: "jpeg",
    quality: 100,
    askWhereToSave: true,
    filenameTemplate: "%domain%_%type%_%date%_%time%",
  });
  assert.deepEqual(normalizeSettings({ quality: 0 }), {
    format: "png",
    quality: 1,
    askWhereToSave: false,
    filenameTemplate: "%domain%_%type%_%date%_%time%",
  });
});

test("declares shortcuts for both capture types", () => {
  assert.equal(manifest.commands["capture-viewport"].suggested_key.mac, "Command+Shift+1");
  assert.equal(manifest.commands["capture-full-page"].suggested_key.mac, "Command+Shift+2");
});
