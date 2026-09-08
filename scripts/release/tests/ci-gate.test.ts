import { describe, expect, it, vi } from "vitest";
import { type CiJob, type CiRun, waitForReleaseCi } from "../ci-gate";

const sha = "a".repeat(40);
const passedRun: CiRun = {
  id: 10,
  head_sha: sha,
  event: "push",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/athasdev/athas/actions/runs/10",
};
const passedJobs: CiJob[] = [
  { name: "Bun — typecheck, frontend check", status: "completed", conclusion: "success" },
  { name: "Rust — fmt, check, clippy, test", status: "completed", conclusion: "success" },
];

function harness(snapshots: CiRun[][], jobs = passedJobs) {
  let now = 0;
  let index = 0;
  return {
    runs: vi.fn(async () => snapshots[Math.min(index++, snapshots.length - 1)]),
    jobs: vi.fn(async () => jobs),
    now: () => now,
    sleep: vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    }),
    log: vi.fn(),
  };
}

const timing = { timeoutMs: 100, pollMs: 10 };

describe("release CI gate", () => {
  it("waits for the exact commit and both required jobs to pass", async () => {
    const io = harness([
      [],
      [{ ...passedRun, status: "queued", conclusion: null }],
      [{ ...passedRun, status: "in_progress", conclusion: null }],
      [passedRun],
    ]);
    await waitForReleaseCi(sha, timing, io);
    expect(io.sleep).toHaveBeenCalledTimes(3);
    expect(io.jobs).toHaveBeenCalledWith(10);
  });

  it.each(["failure", "cancelled", "timed_out", "skipped", "neutral"])(
    "blocks a %s workflow",
    async (conclusion) => {
      await expect(
        waitForReleaseCi(sha, timing, harness([[{ ...passedRun, conclusion }]])),
      ).rejects.toThrow(`CI ${conclusion}`);
    },
  );

  it("does not accept an older success when a newer run fails", async () => {
    const io = harness([[passedRun, { ...passedRun, id: 11, conclusion: "failure" }]]);
    await expect(waitForReleaseCi(sha, timing, io)).rejects.toThrow("CI failure");
  });

  it.each(["skipped", "failure", "cancelled"])(
    "blocks a %s required job even when the workflow reports success",
    async (conclusion) => {
      const io = harness([[passedRun]], [passedJobs[0], { ...passedJobs[1], conclusion }]);
      await expect(waitForReleaseCi(sha, timing, io)).rejects.toThrow("required CI job");
    },
  );

  it("blocks missing required jobs", async () => {
    await expect(
      waitForReleaseCi(sha, timing, harness([[passedRun]], [passedJobs[0]])),
    ).rejects.toThrow("required CI job");
  });

  it("does not accept another commit or a pull request run", async () => {
    const io = harness([
      [
        { ...passedRun, head_sha: "b".repeat(40) },
        { ...passedRun, event: "pull_request" },
      ],
    ]);
    await expect(waitForReleaseCi(sha, timing, io)).rejects.toThrow("timed out");
    expect(io.jobs).not.toHaveBeenCalled();
  });

  it("accepts workflow dispatch for a preview validation branch", async () => {
    await waitForReleaseCi(sha, timing, harness([[{ ...passedRun, event: "workflow_dispatch" }]]));
  });

  it("fails closed when GitHub cannot be queried", async () => {
    const io = harness([]);
    io.runs.mockRejectedValue(new Error("GitHub unavailable"));
    await expect(waitForReleaseCi(sha, timing, io)).rejects.toThrow("GitHub unavailable");
  });

  it("rejects abbreviated SHAs without querying GitHub", async () => {
    const io = harness([]);
    await expect(waitForReleaseCi("abc123", timing, io)).rejects.toThrow("full commit SHA");
    expect(io.runs).not.toHaveBeenCalled();
  });
});
