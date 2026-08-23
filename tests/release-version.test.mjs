import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  chromeCanaryVersion,
  compareVersions,
  incrementVersion,
  parseCanaryTag,
  parseStableTag,
  recommendedBump,
} from "../scripts/release-version.mjs";
import { releaseAssetName, validateReleaseMetadata } from "../scripts/build-release.mjs";

const releaseVersionScript = fileURLToPath(
  new URL("../scripts/release-version.mjs", import.meta.url),
);

function outputMap(output) {
  return Object.fromEntries(
    output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("=")),
  );
}

test("parses stable and canary tags", () => {
  assert.deepEqual(parseStableTag("v1.2.3"), {
    tag: "v1.2.3",
    version: "1.2.3",
    major: 1,
    minor: 2,
    patch: 3,
  });
  assert.equal(parseCanaryTag("v2.0.0-canary.14").stableTag, "v2.0.0");
  assert.equal(parseCanaryTag("v2.0.0-canary.65536").ordinal, 65_536);
  assert.throws(() => parseCanaryTag("v2.0.0-beta.1"), /Invalid canary tag/);
});

test("selects the highest conventional commit bump", () => {
  assert.equal(recommendedBump([{ subject: "docs: clarify installation" }]), "patch");
  assert.equal(
    recommendedBump([
      { subject: "fix: correct redirect" },
      { subject: "feat(tessera): add groups" },
    ]),
    "minor",
  );
  assert.equal(recommendedBump([{ subject: "feat!: replace stored model" }]), "major");
  assert.equal(
    recommendedBump([
      { subject: "fix: change output", body: "BREAKING CHANGE: output is now JSON" },
    ]),
    "major",
  );
});

test("increments and compares semantic versions", () => {
  const version = parseStableTag("v1.2.3");
  assert.deepEqual(incrementVersion(version, "patch"), { major: 1, minor: 2, patch: 4 });
  assert.deepEqual(incrementVersion(version, "minor"), { major: 1, minor: 3, patch: 0 });
  assert.deepEqual(incrementVersion(version, "major"), { major: 2, minor: 0, patch: 0 });
  assert.ok(compareVersions(parseStableTag("v2.0.0"), version) > 0);
});

test("maps canaries between the previous and next Chrome versions", () => {
  const previous = parseStableTag("v1.2.3");
  assert.equal(chromeCanaryVersion(previous, 9), "1.2.3.9");
  assert.throws(() => chromeCanaryVersion(previous, 65_536), /Chrome version components/);
});

test("validates release build metadata and asset names", () => {
  assert.doesNotThrow(() =>
    validateReleaseMetadata({
      tag: "v1.3.0-canary.9",
      browserVersion: "1.2.3.9",
      versionName: "1.3.0-canary.9",
    }),
  );
  assert.equal(
    releaseAssetName("reading-list-manager.zip", "v1.3.0"),
    "reading-list-manager-v1.3.0.zip",
  );
  assert.throws(
    () =>
      validateReleaseMetadata({
        tag: "v1.3.0",
        browserVersion: "1.3.0",
        versionName: "1.3.1",
      }),
    /does not match/,
  );
});

test("calculates and promotes a canary from git history", () => {
  const directory = mkdtempSync(join(tmpdir(), "browser-extensions-release-"));
  const run = (command, arguments_) =>
    execFileSync(command, arguments_, { cwd: directory, encoding: "utf8" });

  try {
    run("git", ["init", "--initial-branch=main"]);
    run("git", ["config", "user.name", "Release Test"]);
    run("git", ["config", "user.email", "release-test@example.com"]);
    run("git", ["config", "commit.gpgSign", "false"]);
    run("git", ["config", "tag.gpgSign", "false"]);
    run("git", ["commit", "--allow-empty", "-m", "chore: establish baseline"]);
    run("git", ["tag", "v1.2.3"]);
    run("git", ["commit", "--allow-empty", "-m", "fix: correct redirect"]);
    run("git", ["commit", "--allow-empty", "-m", "feat: add workspace groups"]);

    const canary = outputMap(
      run(process.execPath, [releaseVersionScript, "canary", "--ref", "HEAD"]),
    );
    assert.equal(canary.tag, "v1.3.0-canary.3");
    assert.equal(canary.browser_version, "1.2.3.2");

    run("git", ["tag", canary.tag]);
    const stable = outputMap(
      run(process.execPath, [
        releaseVersionScript,
        "stable",
        "--candidate",
        canary.tag,
        "--main-ref",
        "HEAD",
      ]),
    );
    assert.equal(stable.tag, "v1.3.0");
    assert.equal(stable.browser_version, "1.3.0");
    assert.equal(stable.candidate_tag, canary.tag);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
