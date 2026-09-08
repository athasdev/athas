import { describe, expect, it } from "vite-plus/test";
import { parseTeamWorkspace } from "../team/utils/team-workspace-config";
import { discoverProjectRunActions } from "@/features/run-actions/utils/run-action-discovery";
import { buildContextPrompt } from "@/features/ai/utils/ai-context-builder";

const config = {
  version: 1,
  name: "Platform",
  instructions: "Use Bun.",
  commands: [{ name: "Web", command: "bun run dev", workingDirectory: "apps/web" }],
};

describe("team workspaces", () => {
  it("loads a portable profile and normalizes relative directories", () => {
    expect(parseTeamWorkspace(JSON.stringify(config))).toEqual(config);
    expect(
      parseTeamWorkspace(
        JSON.stringify({
          ...config,
          commands: [{ ...config.commands[0], workingDirectory: "apps\\web" }],
        }),
      ).commands[0]?.workingDirectory,
    ).toBe("apps/web");
  });
  it.each(["../other", "/tmp", "C:\\other", "remote://host/repo", "apps/../../other", "apps\nweb"])(
    "rejects a nonportable directory: %s",
    (workingDirectory) => {
      expect(() =>
        parseTeamWorkspace(
          JSON.stringify({ ...config, commands: [{ ...config.commands[0], workingDirectory }] }),
        ),
      ).toThrow("relative path");
    },
  );
  it("rejects unsupported versions, invalid commands and unknown fields instead of discarding them", () => {
    for (const invalid of [
      { ...config, version: 2 },
      { ...config, secret: "token" },
      { ...config, commands: [{ name: "test", command: "" }] },
      { ...config, commands: [config.commands[0], config.commands[0]] },
      { ...config, instructions: "x".repeat(20_001) },
    ]) {
      expect(() => parseTeamWorkspace(JSON.stringify(invalid))).toThrow();
    }
    expect(() => parseTeamWorkspace("{")).toThrow("valid JSON");
  });
  it("discovers team commands alongside project commands with workspace-relative paths", async () => {
    const files: Record<string, string> = {
      "/repo/athas.workspace.json": JSON.stringify(config),
      "/repo/package.json": JSON.stringify({ scripts: { test: "vitest" } }),
    };
    const actions = await discoverProjectRunActions("/repo", async (path) => {
      if (!(path in files)) throw new Error("Not found");
      return files[path]!;
    });
    expect(actions[0]).toMatchObject({
      source: "team",
      command: "bun run dev",
      workingDirectory: "/repo/apps/web",
    });
    expect(actions[1]).toMatchObject({ source: "package", command: "npm run test" });
  });
  it("keeps the team name when the same root command is discovered in package.json", async () => {
    const actions = await discoverProjectRunActions("/repo", async (path) => {
      if (path.endsWith("athas.workspace.json"))
        return JSON.stringify({
          ...config,
          commands: [{ name: "Start team app", command: "npm run dev" }],
        });
      if (path.endsWith("package.json")) return JSON.stringify({ scripts: { dev: "vite" } });
      throw new Error("Not found");
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.name).toBe("Start team app");
  });
  it.each(["custom", "claude", "codex"])(
    "includes team instructions as project context for %s",
    (agentId) => {
      const prompt = buildContextPrompt({
        projectRoot: "/repo",
        agentId,
        teamInstructions: "Use Bun.",
      });
      expect(prompt).toContain("Use Bun.");
      expect(prompt).toContain("athas.workspace.json");
      expect(buildContextPrompt({ projectRoot: "/other", agentId })).not.toContain("Use Bun.");
    },
  );
});

describe("shared workspace metadata", () => {
  it("round-trips repositories and recommendations without machine paths", () => {
    const profile = {
      ...config,
      description: "Platform team",
      repositories: [{ id: "web", name: "Web", url: "https://github.com/team/web" }],
      recommendedExtensions: ["typescript", "typescript", "rust"],
    };
    expect(parseTeamWorkspace(JSON.stringify(profile))).toEqual({
      ...profile,
      recommendedExtensions: ["typescript", "rust"],
    });
  });
  it.each([
    "file:///home/me",
    "https://token@github.com/team/repo",
    "https://github.com/team/repo?token=secret",
    "javascript:alert(1)",
  ])("rejects an unsafe shared repository URL: %s", (url) => {
    expect(() =>
      parseTeamWorkspace(
        JSON.stringify({ ...config, repositories: [{ id: "web", name: "Web", url }] }),
      ),
    ).toThrow();
  });
  it("rejects duplicate repository IDs and machine-local fields", () => {
    expect(() =>
      parseTeamWorkspace(
        JSON.stringify({
          ...config,
          repositories: [
            { id: "web", name: "Web" },
            { id: "web", name: "Other" },
          ],
        }),
      ),
    ).toThrow("unique ID");
    expect(() =>
      parseTeamWorkspace(
        JSON.stringify({ ...config, repositories: [{ id: "web", name: "Web", path: "/private" }] }),
      ),
    ).toThrow("Unknown");
  });
});
