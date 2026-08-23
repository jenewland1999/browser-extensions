import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { archives } from "./archive-spec.js";

const executableCandidates = [
  process.env.CHROME_PATH,
  process.platform === "darwin" &&
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  process.platform === "darwin" && "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "chrome-for-testing",
  "chromium",
  "chromium-browser",
].filter(Boolean);

function extensionId(path) {
  return [...createHash("sha256").update(path).digest().subarray(0, 16)]
    .flatMap((byte) => [
      String.fromCharCode(97 + (byte >> 4)),
      String.fromCharCode(97 + (byte & 15)),
    ])
    .join("");
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForFile(path, processHandle) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Chromium exited with code ${processHandle.exitCode}.`);
    }

    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await wait(100);
  }
  throw new Error("Timed out waiting for Chromium's DevTools endpoint.");
}

async function evaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  try {
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
    return await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error("DevTools evaluation timed out.")), 10_000);
      socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.result.exceptionDetails) {
          reject(
            new Error(
              message.result.exceptionDetails.exception?.description ??
                message.result.exceptionDetails.text ??
                "DevTools evaluation failed.",
            ),
          );
          return;
        }
        resolvePromise(message.result.result.value);
      });
    });
  } finally {
    socket.close();
  }
}

async function findExecutable() {
  for (const candidate of executableCandidates) {
    if (candidate.includes("/")) {
      try {
        await import("node:fs/promises").then(({ access }) => access(candidate));
        return candidate;
      } catch {}
    } else {
      const child = spawn("sh", ["-c", `command -v "$1"`, "sh", candidate], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      if ((await new Promise((resolvePromise) => child.on("close", resolvePromise))) === 0) {
        return output.trim();
      }
    }
  }
  throw new Error(
    "Chrome for Testing or Chromium was not found. Set CHROME_PATH to its executable.",
  );
}

const executable = await findExecutable();
const profileDirectory = mkdtempSync(join(tmpdir(), "extension-smoke-"));
const extensions = archives.map(({ extension, page, background = false }) => {
  const path = resolve("extensions", extension, "dist");
  return { extension, page: page ?? null, background, path, id: extensionId(path) };
});
const extensionPaths = extensions.map(({ path }) => path).join(",");
const arguments_ = [
  `--user-data-dir=${profileDirectory}`,
  "--remote-debugging-port=0",
  "--no-first-run",
  "--no-default-browser-check",
  `--disable-extensions-except=${extensionPaths}`,
  `--load-extension=${extensionPaths}`,
];

if (process.platform === "linux") arguments_.push("--no-sandbox");
arguments_.push("about:blank");

const browser = spawn(executable, arguments_, { stdio: ["ignore", "ignore", "pipe"] });
let standardError = "";
const collectStandardError = (chunk) => (standardError += chunk);
const browserClosed = new Promise((resolvePromise) => browser.once("close", resolvePromise));
browser.stderr.on("data", collectStandardError);

try {
  const [port] = (await waitForFile(join(profileDirectory, "DevToolsActivePort"), browser))
    .trim()
    .split("\n");
  const origin = `http://127.0.0.1:${port}`;

  for (const extension of extensions) {
    if (extension.page === null) {
      console.log(`Loaded ${extension.extension} (${extension.id}, no extension page).`);
      continue;
    }

    const url = `chrome-extension://${extension.id}/${extension.page}`;
    const response = await fetch(`${origin}/json/new?${encodeURI(url)}`, {
      method: "PUT",
    });
    if (!response.ok) throw new Error(`Could not open ${url}: HTTP ${response.status}.`);
    const target = await response.json();

    let state;
    for (let attempt = 0; attempt < 100 && !state?.ready; attempt += 1) {
      state = await evaluate(
        target.webSocketDebuggerUrl,
        "({ id: globalThis.chrome?.runtime?.id, ready: document.documentElement?.dataset.extensionReady === 'true' })",
      );
      if (state?.id !== extension.id || !state.ready) await wait(100);
    }

    if (state?.id !== extension.id || !state.ready) {
      throw new Error(
        `${extension.extension} did not finish startup (received ${JSON.stringify(state)}).`,
      );
    }
    console.log(`Loaded ${extension.extension} (${extension.id}).`);
  }

  const backgroundIds = new Set(
    extensions.filter(({ background }) => background).map(({ id }) => id),
  );
  for (let attempt = 0; attempt < 50 && backgroundIds.size > 0; attempt += 1) {
    const targets = await fetch(`${origin}/json/list`).then((response) => response.json());
    for (const target of targets) {
      if (target.type !== "service_worker") continue;
      const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(target.url);
      if (match?.[1]) backgroundIds.delete(match[1]);
    }
    if (backgroundIds.size > 0) await wait(100);
  }
  if (backgroundIds.size > 0) {
    throw new Error(`Background service workers did not start: ${[...backgroundIds].join(", ")}.`);
  }
} catch (error) {
  if (standardError) error.message += `\nChromium stderr:\n${standardError}`;
  throw error;
} finally {
  if (browser.exitCode === null && browser.signalCode === null) browser.kill("SIGTERM");

  const closedGracefully = await Promise.race([
    browserClosed.then(() => true),
    wait(5_000).then(() => false),
  ]);
  if (!closedGracefully) {
    browser.kill("SIGKILL");
    await browserClosed;
  }

  browser.stderr.off("data", collectStandardError);
  browser.removeAllListeners();
  rmSync(profileDirectory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
}

console.log(`Smoke-tested ${archives.length} unpacked extensions with ${basename(executable)}.`);
