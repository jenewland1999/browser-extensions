import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const versionPart = "(0|[1-9]\\d*)";
const stableTagPattern = new RegExp(`^v${versionPart}\\.${versionPart}\\.${versionPart}$`);
const canaryTagPattern = new RegExp(
  `^v${versionPart}\\.${versionPart}\\.${versionPart}-canary\\.${versionPart}$`,
);
const conventionalSubjectPattern = /^([a-z][a-z0-9-]*)(?:\([^\r\n()]+\))?(!)?:/;
const maximumChromeVersionPart = 65_535;

function parseNumericParts(match, count) {
  const parts = match.slice(1, count + 1).map(Number);

  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error("Version components must be safe integers.");
  }

  return parts;
}

export function parseStableTag(tag) {
  const match = stableTagPattern.exec(tag);
  if (!match) throw new Error(`Invalid stable tag: ${tag}`);

  const [major, minor, patch] = parseNumericParts(match, 3);
  return { tag, version: `${major}.${minor}.${patch}`, major, minor, patch };
}

export function parseCanaryTag(tag) {
  const match = canaryTagPattern.exec(tag);
  if (!match) throw new Error(`Invalid canary tag: ${tag}`);

  const [major, minor, patch, ordinal] = parseNumericParts(match, 4);
  if (ordinal < 1) throw new Error("Canary number must be greater than zero.");

  return {
    tag,
    version: `${major}.${minor}.${patch}`,
    versionName: `${major}.${minor}.${patch}-canary.${ordinal}`,
    stableTag: `v${major}.${minor}.${patch}`,
    major,
    minor,
    patch,
    ordinal,
  };
}

export function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}

export function recommendedBump(commits) {
  let bump = "patch";

  for (const { subject, body = "" } of commits) {
    const match = conventionalSubjectPattern.exec(subject);
    const breaking = match?.[2] === "!" || /^BREAKING(?: |-)CHANGE:/m.test(body);

    if (breaking) return "major";
    if (match?.[1] === "feat") bump = "minor";
  }

  return bump;
}

export function incrementVersion(version, bump) {
  if (bump === "major") return { major: version.major + 1, minor: 0, patch: 0 };
  if (bump === "minor") {
    return { major: version.major, minor: version.minor + 1, patch: 0 };
  }
  if (bump === "patch") {
    return { major: version.major, minor: version.minor, patch: version.patch + 1 };
  }
  throw new Error(`Unsupported version bump: ${bump}`);
}

export function chromeCanaryVersion(stableVersion, ordinal) {
  const parts = [stableVersion.major, stableVersion.minor, stableVersion.patch, ordinal];
  if (parts.some((part) => part < 0 || part > maximumChromeVersionPart)) {
    throw new Error(`Chrome version components must be between 0 and ${maximumChromeVersionPart}.`);
  }
  if (parts.every((part) => part === 0)) throw new Error("Chrome versions cannot be all zero.");
  return parts.join(".");
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function tagExists(tag) {
  const result = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Unable to inspect tag ${tag}.`);
}

function isAncestor(ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Unable to compare ${ancestor} with ${descendant}.`);
}

function stableTagsMergedInto(ref) {
  const output = git(["tag", "--merged", ref]);
  if (!output) return [];

  return output
    .split("\n")
    .filter((tag) => stableTagPattern.test(tag))
    .map(parseStableTag)
    .sort(compareVersions);
}

function latestStable(ref) {
  const tags = stableTagsMergedInto(ref);
  if (tags.length === 0) {
    throw new Error(
      "No stable tag is reachable from the release commit. Create the documented v1.0.0 baseline tag first.",
    );
  }
  return tags.at(-1);
}

function commitsBetween(fromTag, toRef) {
  const output = git(["log", "--format=%s%x1f%b%x1e", `${fromTag}..${toRef}`]);
  if (!output) return [];

  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [subject, body = ""] = record.split("\x1f");
      return { subject: subject.trim(), body: body.trim() };
    });
}

function calculateCanary(ref) {
  const previous = latestStable(ref);
  const commits = commitsBetween(previous.tag, ref);
  const canaryNumber = Number(git(["rev-list", "--count", ref]));
  const browserOrdinal = Number(git(["rev-list", "--count", `${previous.tag}..${ref}`]));

  if (commits.length === 0 || browserOrdinal < 1) {
    throw new Error(`${ref} contains no commits after ${previous.tag}.`);
  }
  if (browserOrdinal > maximumChromeVersionPart) {
    throw new Error(`Canary build number exceeds Chrome's ${maximumChromeVersionPart} limit.`);
  }

  const bump = recommendedBump(commits);
  const next = incrementVersion(previous, bump);
  const version = `${next.major}.${next.minor}.${next.patch}`;
  const versionName = `${version}-canary.${canaryNumber}`;

  return {
    tag: `v${versionName}`,
    version,
    version_name: versionName,
    browser_version: chromeCanaryVersion(previous, browserOrdinal),
    previous_stable_tag: previous.tag,
    previous_stable_version: previous.version,
    canary_number: String(canaryNumber),
    browser_ordinal: String(browserOrdinal),
    bump,
    sha: git(["rev-parse", `${ref}^{commit}`]),
  };
}

function calculateStable(candidateTag, mainRef) {
  const candidate = parseCanaryTag(candidateTag);
  if (!tagExists(candidateTag)) throw new Error(`Canary tag does not exist: ${candidateTag}`);

  const candidateSha = git(["rev-parse", `${candidateTag}^{commit}`]);
  if (!isAncestor(candidateSha, mainRef)) {
    throw new Error(`${candidateTag} is not contained in ${mainRef}.`);
  }

  const expected = calculateCanary(candidateSha);
  if (expected.tag !== candidateTag) {
    throw new Error(`Expected ${expected.tag} for ${candidateSha}, not ${candidateTag}.`);
  }

  const currentStable = latestStable(mainRef);
  if (currentStable.tag !== expected.previous_stable_tag) {
    throw new Error(
      `${candidateTag} is stale: it follows ${expected.previous_stable_tag}, but the current stable tag is ${currentStable.tag}.`,
    );
  }
  if (compareVersions(candidate, currentStable) <= 0) {
    throw new Error(`${candidateTag} does not advance beyond ${currentStable.tag}.`);
  }
  if (tagExists(candidate.stableTag)) {
    throw new Error(`Stable tag already exists: ${candidate.stableTag}`);
  }

  return {
    tag: candidate.stableTag,
    version: candidate.version,
    version_name: candidate.version,
    browser_version: candidate.version,
    candidate_tag: candidateTag,
    previous_stable_tag: currentStable.tag,
    sha: candidateSha,
  };
}

function parseArguments(arguments_) {
  const [command, ...rest] = arguments_;
  const options = {};

  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument list: ${rest.join(" ")}`);
    }
    options[name.slice(2).replaceAll("-", "_")] = value;
  }

  return { command, options };
}

function printOutputs(outputs) {
  for (const [name, value] of Object.entries(outputs)) console.log(`${name}=${value}`);
}

function main() {
  const { command, options } = parseArguments(process.argv.slice(2));

  if (command === "canary") {
    const outputs = calculateCanary(options.ref ?? "HEAD");
    if (tagExists(outputs.tag)) throw new Error(`Canary tag already exists: ${outputs.tag}`);
    printOutputs(outputs);
    return;
  }

  if (command === "stable") {
    if (!options.candidate) throw new Error("stable requires --candidate <tag>.");
    printOutputs(calculateStable(options.candidate, options.main_ref ?? "origin/main"));
    return;
  }

  throw new Error("Usage: release-version.js canary [--ref <ref>] | stable --candidate <tag>");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
