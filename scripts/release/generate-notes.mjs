#!/usr/bin/env bun

import { $ } from "bun";
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);

function getArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function text(command) {
  return (await $`bash -lc ${command}`.text()).trim();
}

async function getPreviousTag(tag) {
  const isPreview = /-preview\.\d+$/.test(tag);
  const tags = await text("git tag --sort=-creatordate --merged HEAD");
  return tags
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => entry !== tag)
    .filter((entry) => /^v\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(entry))
    .find((entry) => isPreview || /^v\d+\.\d+\.\d+$/.test(entry));
}

async function getComparableRevision(tag) {
  try {
    await text(`git rev-parse --verify ${shellQuote(tag)}`);
    return tag;
  } catch {
    return "HEAD";
  }
}

async function getCommits(previousTag, tag) {
  const revision = await getComparableRevision(tag);
  const range = previousTag ? `${previousTag}..${revision}` : revision;
  const output = await text(
    `git log ${shellQuote(range)} --pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ae`,
  );

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, subject, authorName, authorEmail] = line.split("\x1f");
      return { hash, shortHash, subject, authorName, authorEmail };
    });
}

function contributorKey(commit) {
  return `${commit.authorName} <${commit.authorEmail}>`;
}

function formatBody(tag, previousTag, commits) {
  const version = tag.replace(/^v/, "");
  const isPrerelease = /-preview\.\d+$/.test(version);
  const compareRange = previousTag ? `${previousTag}...${tag}` : tag;
  const contributors = new Map();
  const lines = [];

  for (const commit of commits) {
    const key = contributorKey(commit);
    const entry = contributors.get(key) ?? {
      name: commit.authorName,
      email: commit.authorEmail,
      count: 0,
    };
    entry.count += 1;
    contributors.set(key, entry);
  }

  lines.push(`## Athas ${tag}`);
  lines.push("");
  lines.push(
    isPrerelease
      ? `Preview release generated from ${commits.length} commits since ${previousTag ?? "the first tracked release"}.`
      : `Stable release generated from ${commits.length} commits since ${previousTag ?? "the first tracked release"}.`,
  );
  lines.push("");
  lines.push("### Changes");
  if (commits.length === 0) {
    lines.push("- No commits found in this range.");
  } else {
    for (const commit of commits) {
      lines.push(`- ${commit.subject} (${commit.shortHash}, ${commit.authorName})`);
    }
  }
  lines.push("");
  lines.push("### Contributors");
  if (contributors.size === 0) {
    lines.push("- No contributors found in this range.");
  } else {
    const sortedContributors = [...contributors.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
    for (const contributor of sortedContributors) {
      lines.push(
        `- ${contributor.name} (${contributor.count} commit${contributor.count === 1 ? "" : "s"})`,
      );
    }
  }
  lines.push("");
  lines.push(`**Full Changelog**: https://github.com/athasdev/athas/compare/${compareRange}`);

  return lines.join("\n");
}

function writeGithubOutput(path, outputs) {
  const chunks = [];
  for (const [key, value] of Object.entries(outputs)) {
    if (value.includes("\n")) {
      chunks.push(`${key}<<EOF_${key}\n${value}\nEOF_${key}`);
    } else {
      chunks.push(`${key}=${value}`);
    }
  }
  appendFileSync(path, `${chunks.join("\n")}\n`);
}

const tag = getArg("--tag") || process.env.GITHUB_REF_NAME;
if (!tag) {
  console.error("Missing --tag");
  process.exit(1);
}

const outputPath = getArg("--github-output");
const previousTag = await getPreviousTag(tag);
const commits = await getCommits(previousTag, tag);
const releaseBody = formatBody(tag, previousTag, commits);
const version = tag.replace(/^v/, "");
const isPrerelease = /-preview\.\d+$/.test(version) ? "true" : "false";
const releaseName = `Athas ${tag}`;

if (outputPath) {
  writeGithubOutput(outputPath, {
    release_name: releaseName,
    release_body: releaseBody,
    is_prerelease: isPrerelease,
  });
} else {
  console.log(releaseBody);
}
