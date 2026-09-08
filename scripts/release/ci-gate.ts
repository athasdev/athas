import { execFile } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);

const repository = "athasdev/athas";
const requiredJobs = ["Bun — typecheck, frontend check", "Rust — fmt, check, clippy, test"];

export interface CiRun {
  id: number;
  head_sha: string;
  event: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export interface CiJob {
  name: string;
  status: string;
  conclusion: string | null;
}

interface CiGateDependencies {
  runs: (sha: string) => Promise<CiRun[]>;
  jobs: (runId: number) => Promise<CiJob[]>;
  now: () => number;
  sleep: (milliseconds: number) => Promise<unknown>;
  log: (message: string) => void;
}

const dependencies: CiGateDependencies = {
  async runs(sha) {
    const { stdout } = await execute("gh", [
      "api",
      `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`,
    ]);
    return JSON.parse(stdout).workflow_runs;
  },
  async jobs(runId) {
    const { stdout } = await execute("gh", [
      "api",
      `repos/${repository}/actions/runs/${runId}/jobs?per_page=100`,
    ]);
    return JSON.parse(stdout).jobs;
  },
  now: Date.now,
  sleep: setTimeout,
  log: console.log,
};

export async function waitForReleaseCi(
  sha: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
  io: CiGateDependencies = dependencies,
): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Release CI requires a full commit SHA");

  const deadline = io.now() + (options.timeoutMs ?? 45 * 60 * 1000);
  let lastState = "";

  while (io.now() < deadline) {
    const run = (await io.runs(sha))
      .filter(
        (candidate) =>
          candidate.head_sha === sha && ["push", "workflow_dispatch"].includes(candidate.event),
      )
      .sort((a, b) => b.id - a.id)[0];

    const state = run ? `${run.html_url}: ${run.status}` : `Waiting for CI for ${sha}`;
    if (state !== lastState) {
      io.log(state);
      lastState = state;
    }

    if (run?.status === "completed") {
      if (run.conclusion !== "success") {
        throw new Error(`Release blocked: CI ${run.conclusion} for ${sha}: ${run.html_url}`);
      }
      const jobs = await io.jobs(run.id);
      for (const name of requiredJobs) {
        const matches = jobs.filter((job) => job.name === name);
        if (
          matches.length !== 1 ||
          matches[0].status !== "completed" ||
          matches[0].conclusion !== "success"
        ) {
          throw new Error(
            `Release blocked: required CI job '${name}' did not pass: ${run.html_url}`,
          );
        }
      }
      io.log(`Release CI passed for ${sha}`);
      return;
    }
    await io.sleep(options.pollMs ?? 30_000);
  }
  throw new Error(`Release blocked: timed out waiting for CI for ${sha}`);
}

if (import.meta.main) {
  await waitForReleaseCi(process.argv[2] ?? "");
}
