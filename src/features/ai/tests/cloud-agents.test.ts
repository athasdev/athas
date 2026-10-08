import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/services/auth-api", () => ({ authenticatedFetch: fetchMock }));

import { formatCloudAgentLogLine } from "../cloud-agents/cloud-agent-log-format";
import {
  CloudAgentsError,
  isActiveCloudAgentRun,
  startCloudAgentRun,
} from "../cloud-agents/cloud-agents-api";

const stdout = (event: unknown) => ({
  at: 0,
  stream: "stdout" as const,
  text: JSON.stringify(event),
});

beforeEach(() => fetchMock.mockReset());

describe("cloud agent logs", () => {
  it("shows Claude Code's messages, tool calls and result", () => {
    expect(
      formatCloudAgentLogLine(
        stdout({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Reading the failing test." },
              { type: "tool_use", name: "Bash", input: { command: "bun test dates" } },
            ],
          },
        }),
      ),
    ).toBe("Reading the failing test.\n→ Bash bun test dates");
    expect(formatCloudAgentLogLine(stdout({ type: "result", result: "Fixed the parser." }))).toBe(
      "Fixed the parser.",
    );
  });

  it("shows Codex messages and commands", () => {
    expect(
      formatCloudAgentLogLine(
        stdout({ type: "item.completed", item: { type: "agent_message", text: "Done." } }),
      ),
    ).toBe("Done.");
    expect(
      formatCloudAgentLogLine(
        stdout({ type: "item.completed", item: { type: "command_execution", command: "ls" } }),
      ),
    ).toBe("→ ls");
  });

  it("hides events with nothing to read and passes plain text through", () => {
    expect(formatCloudAgentLogLine(stdout({ type: "system", subtype: "init" }))).toBeNull();
    expect(formatCloudAgentLogLine({ at: 0, stream: "system", text: "Cloning" })).toBe("Cloning");
    expect(formatCloudAgentLogLine({ at: 0, stream: "stdout", text: "plain" })).toBe("plain");
  });
});

describe("cloud agents API", () => {
  it("starts a run with the given credentials", async () => {
    const run = { id: "run-1", status: "queued" };
    fetchMock.mockResolvedValue(Response.json({ run }, { status: 201 }));
    const input = {
      repo: "athasdev/athas",
      baseBranch: "main",
      prompt: "Fix it",
      agent: "claude-code" as const,
      maxMinutes: 60,
      credentials: { anthropicApiKey: "sk-ant-key" },
    };
    expect(await startCloudAgentRun(input)).toEqual(run);
    expect(fetchMock).toHaveBeenCalledWith("/api/cloud-agents/runs", {
      method: "POST",
      body: JSON.stringify(input),
    });
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
      maxMinutes: 30,
      credentials: { openaiApiKey: "sk-key" },
    });
    await expect(failure).rejects.toBeInstanceOf(CloudAgentsError);
    await expect(failure).rejects.toMatchObject({
      message: "Connect GitHub",
      status: 400,
      code: "github_not_connected",
    });
  });

  it("treats queued and running runs as active", () => {
    expect(isActiveCloudAgentRun({ status: "queued" })).toBe(true);
    expect(isActiveCloudAgentRun({ status: "running" })).toBe(true);
    expect(isActiveCloudAgentRun({ status: "succeeded" })).toBe(false);
  });
});
