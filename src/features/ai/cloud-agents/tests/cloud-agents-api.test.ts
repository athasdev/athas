import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fetchMock = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/features/auth/services/auth-api", () => ({
  authenticatedFetch: (path: string, init?: RequestInit) => {
    if (!session.signedIn) throw new Error("Not authenticated");
    return fetchMock(path, init);
  },
}));

import {
  CloudAgentsError,
  isActiveCloudAgentRun,
  listCloudAgentBranches,
  listCloudAgentRepos,
  startCloudAgentRun,
} from "../services/cloud-agents-api";
import { buildCloudRunTranscript, formatCloudRunLog } from "../services/cloud-run-transcript";

const stdout = (event: unknown, at = 0) => ({
  at,
  stream: "stdout" as const,
  text: JSON.stringify(event),
});

beforeEach(() => {
  fetchMock.mockReset();
  session.signedIn = true;
});

describe("cloud agents API", () => {
  it("starts a run on Athas credit without credentials", async () => {
    const run = { id: "run-1", status: "queued" };
    fetchMock.mockResolvedValue(Response.json({ run }, { status: 201 }));
    const input = {
      repo: "athasdev/athas",
      baseBranch: "main",
      prompt: "Fix it",
      agent: "claude-code" as const,
      maxMinutes: 60,
    };
    expect(await startCloudAgentRun(input)).toEqual(run);
    expect(fetchMock).toHaveBeenCalledWith("/api/cloud-agents/runs", {
      method: "POST",
      body: JSON.stringify(input),
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty("credentials");
  });

  it("raises the server's message and code", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "Connect GitHub", code: "github_not_connected" }, { status: 400 }),
    );
    const failure = startCloudAgentRun({
      repo: "a/b",
      baseBranch: "main",
      prompt: "x",
      agent: "codex",
    });
    await expect(failure).rejects.toBeInstanceOf(CloudAgentsError);
    await expect(failure).rejects.toMatchObject({
      message: "Connect GitHub",
      status: 400,
      code: "github_not_connected",
    });
  });

  it("asks to sign in when there is no session", async () => {
    session.signedIn = false;
    const error = await startCloudAgentRun({
      repo: "a/b",
      baseBranch: "main",
      prompt: "x",
      agent: "codex",
    }).catch((cause: unknown) => cause);
    expect(error instanceof CloudAgentsError).toBe(true);
    const { code, status, message } = error as CloudAgentsError;
    expect({ code, status, message }).toEqual({
      code: "unavailable",
      status: 0,
      message: "Sign in to Athas to run agents in the cloud.",
    });
  });

  it("treats queued and running runs as active", () => {
    expect(isActiveCloudAgentRun({ status: "queued" })).toBe(true);
    expect(isActiveCloudAgentRun({ status: "running" })).toBe(true);
    expect(isActiveCloudAgentRun({ status: "succeeded" })).toBe(false);
  });

  it("lists repositories from the cloud agents endpoint", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        repos: [
          {
            fullName: "athasdev/athas",
            defaultBranch: "main",
            private: false,
            pushedAt: "2026-10-01T00:00:00Z",
          },
          { name: "missing full name" },
        ],
      }),
    );
    expect(await listCloudAgentRepos()).toEqual([
      {
        fullName: "athasdev/athas",
        defaultBranch: "main",
        private: false,
        pushedAt: "2026-10-01T00:00:00Z",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/cloud-agents/repos", undefined);
  });

  it("falls back to the GitHub integration when the server has no repository listing", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: "Not found" }, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({ repos: [{ fullName: "me/private", private: true, description: null }] }),
      );
    expect(await listCloudAgentRepos()).toEqual([
      { fullName: "me/private", defaultBranch: null, private: true, pushedAt: null },
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/integrations/github/repos", undefined);
  });

  it("keeps GitHub connection errors instead of falling back", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "Connect GitHub", code: "github_not_connected" }, { status: 409 }),
    );
    await expect(listCloudAgentRepos()).rejects.toMatchObject({ code: "github_not_connected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a repository's branches", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ defaultBranch: "main", branches: [{ name: "main" }, { name: "dev" }, "x"] }),
    );
    expect(await listCloudAgentBranches("athasdev/athas")).toEqual({
      defaultBranch: "main",
      branches: ["main", "dev", "x"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cloud-workspaces/branches?repo=athasdev%2Fathas",
      undefined,
    );
  });
});

describe("cloud run transcript", () => {
  it("reads Claude Code's words, tool calls, results and todo list", () => {
    const transcript = buildCloudRunTranscript([
      { at: 1, stream: "system", text: "Cloning athasdev/athas" },
      stdout({ type: "system", subtype: "init" }),
      stdout(
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Reading the failing test." },
              { type: "tool_use", id: "t1", name: "Bash", input: { command: "bun test dates" } },
              {
                type: "tool_use",
                id: "t2",
                name: "TodoWrite",
                input: { todos: [{ content: "Fix parser", status: "in_progress" }] },
              },
            ],
          },
        },
        1000,
      ),
      stdout(
        {
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "t1", content: "1 failed", is_error: true },
            ],
          },
        },
        3000,
      ),
      stdout({ type: "result", result: "Fixed the parser." }),
    ]);
    expect(transcript.content).toBe("Reading the failing test.\n\nFixed the parser.");
    expect(transcript.status).toBe("Cloning athasdev/athas");
    expect(transcript.plan).toEqual([
      { content: "Fix parser", status: "in_progress", priority: "medium" },
    ]);
    expect(transcript.toolCalls).toHaveLength(1);
    expect(transcript.toolCalls[0]).toMatchObject({
      id: "t1",
      name: "Bash",
      input: { command: "bun test dates" },
      status: "failed",
      output: "1 failed",
      durationMs: 2000,
      contentOffset: "Reading the failing test.".length,
    });
  });

  it("reads Codex messages, commands and file changes", () => {
    const transcript = buildCloudRunTranscript([
      stdout({
        type: "item.started",
        item: { id: "c1", type: "command_execution", command: "ls" },
      }),
      stdout({
        type: "item.completed",
        item: {
          id: "c1",
          type: "command_execution",
          command: "ls",
          aggregated_output: "a\nb",
          exit_code: 0,
        },
      }),
      stdout({
        type: "item.completed",
        item: { id: "f1", type: "file_change", changes: [{ path: "src/a.ts", kind: "update" }] },
      }),
      stdout({ type: "item.completed", item: { id: "m1", type: "agent_message", text: "Done." } }),
    ]);
    expect(transcript.content).toBe("Done.");
    expect(transcript.toolCalls.map((call) => [call.name, call.status])).toEqual([
      ["Bash", "completed"],
      ["Edit", "completed"],
    ]);
    expect(transcript.toolCalls[1]!.input).toEqual({ path: "src/a.ts" });
  });

  it("keeps a still-running tool call open and ignores unreadable lines", () => {
    const transcript = buildCloudRunTranscript([
      { at: 0, stream: "stdout", text: "plain text" },
      { at: 0, stream: "stderr", text: "warning" },
      stdout({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t", name: "Read", input: { file_path: "a.ts" } }],
        },
      }),
    ]);
    expect(transcript.content).toBe("");
    expect(transcript.toolCalls[0]).toMatchObject({ status: "in_progress" });
    expect(transcript.toolCalls[0]!.isComplete).toBeUndefined();
  });

  it("formats the raw log for reading", () => {
    expect(
      formatCloudRunLog([
        { at: 0, stream: "system", text: "Cloning" },
        stdout({
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: "ls" } }],
          },
        }),
        stdout({ type: "result", result: "Done" }),
      ]),
    ).toBe("Cloning\n→ Bash ls");
  });
});
