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

async function generateGithubNotes(tag, previousTag, repo) {
  const targetCommitish = await getComparableRevision(tag);
  const args = ["repos", repo, "releases", "generate-notes"].join("/");
  const previousTagArg = previousTag ? ` -f previous_tag_name=${shellQuote(previousTag)}` : "";
  return text(
    `gh api ${shellQuote(args)} -X POST -f tag_name=${shellQuote(tag)} -f target_commitish=${shellQuote(targetCommitish)}${previousTagArg} --jq .body`,
  );
}

function formatBody(githubNotes, tag, previousTag) {
  const compareRange = previousTag ? `${previousTag}...${tag}` : tag;
  const pullRequestLines = githubNotes
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => /^\* .+ by @.+ in https:\/\/github\.com\/.+\/pull\/\d+$/.test(line));
  const lines = [...pullRequestLines];
  if (lines.length > 0) {
    lines.push("");
  }
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
const repo = getArg("--repo") || process.env.GITHUB_REPOSITORY || "athasdev/athas";
const previousTag = await getPreviousTag(tag);
const githubNotes = await generateGithubNotes(tag, previousTag, repo);
const releaseBody = formatBody(githubNotes, tag, previousTag);
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
