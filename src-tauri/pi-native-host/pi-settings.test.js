import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearPiAuthCredential,
  getPiSettingsSnapshot,
  setPiApiKeyCredential,
  setPiScopedDefaults,
} from "./pi-settings.mjs";

const tempDirs = [];

function createTempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "athas-pi-settings-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  tempDirs.push(root);
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { root, agentDir, cwd };
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("pi-native host settings helpers", () => {
  test("reads effective defaults and discovered resources from shared Pi files", async () => {
    const { agentDir, cwd } = createTempWorkspace();
    const projectPromptDir = join(cwd, ".pi", "prompts");
    mkdirSync(projectPromptDir, { recursive: true });
    writeFileSync(
      join(projectPromptDir, "ship-it.md"),
      "# Ship It\n\nPrepare a release summary.\n",
      "utf8",
    );
    writeJson(join(agentDir, "settings.json"), {
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.4",
      defaultThinkingLevel: "medium",
    });
    writeJson(join(cwd, ".pi", "settings.json"), {
      defaultModel: "gpt-5.4-mini",
      prompts: ["./prompts"],
    });

    const snapshot = await getPiSettingsSnapshot({ cwd, agentDir });

    expect(snapshot.hasProjectScope).toBe(true);
    expect(snapshot.defaults.global).toEqual({
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.4",
      defaultThinkingLevel: "medium",
    });
    expect(snapshot.defaults.project).toEqual({
      defaultProvider: null,
      defaultModel: "gpt-5.4-mini",
      defaultThinkingLevel: null,
    });
    expect(snapshot.defaults.effective).toEqual({
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.4-mini",
      defaultThinkingLevel: "medium",
    });
    expect(
      snapshot.resources.some((resource) => {
        return (
          resource.kind === "prompts" &&
          resource.path === join(projectPromptDir, "ship-it.md") &&
          resource.scope === "project"
        );
      }),
    ).toBe(true);
    expect(
      snapshot.providers.some((provider) => {
        return provider.id === "openai-codex" || provider.id === "openai";
      }),
    ).toBe(true);
  });

  test("writes scoped defaults without clobbering unrelated settings", async () => {
    const { agentDir, cwd } = createTempWorkspace();
    writeJson(join(agentDir, "settings.json"), {
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.4",
      default_provider: "openai-codex",
      default_model: "gpt-5.4",
      default_thinking_level: "medium",
      theme: "dark",
    });
    writeJson(join(cwd, ".pi", "settings.json"), {
      prompts: ["./prompts"],
    });

    await setPiScopedDefaults({
      cwd,
      agentDir,
      scope: "global",
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-6",
      defaultThinkingLevel: "high",
    });

    const snapshot = await setPiScopedDefaults({
      cwd,
      agentDir,
      scope: "project",
      defaultModel: "claude-sonnet-4-6",
      defaultThinkingLevel: "minimal",
    });

    expect(snapshot.defaults.global).toEqual({
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-6",
      defaultThinkingLevel: "high",
    });
    expect(snapshot.defaults.project).toEqual({
      defaultProvider: null,
      defaultModel: "claude-sonnet-4-6",
      defaultThinkingLevel: "minimal",
    });
    expect(snapshot.packages.global).toEqual([]);
    expect(snapshot.packages.project).toEqual([]);

    const globalSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
    expect(globalSettings.defaultProvider).toBe("anthropic");
    expect(globalSettings.defaultModel).toBe("claude-sonnet-4-6");
    expect(globalSettings.defaultThinkingLevel).toBe("high");
    expect(globalSettings.default_provider).toBe("anthropic");
    expect(globalSettings.default_model).toBe("claude-sonnet-4-6");
    expect(globalSettings.default_thinking_level).toBe("high");

    const projectSettings = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8"));
    expect(projectSettings.defaultModel).toBe("claude-sonnet-4-6");
    expect(projectSettings.defaultThinkingLevel).toBe("minimal");
    expect(projectSettings.default_model).toBe("claude-sonnet-4-6");
    expect(projectSettings.default_thinking_level).toBe("minimal");
  });

  test("clears inherited scoped defaults by removing keys instead of writing null", async () => {
    const { agentDir, cwd } = createTempWorkspace();
    writeJson(join(agentDir, "settings.json"), {
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.4",
      defaultThinkingLevel: "medium",
    });
    writeJson(join(cwd, ".pi", "settings.json"), {
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-6",
      defaultThinkingLevel: "high",
    });

    const snapshot = await setPiScopedDefaults({
      cwd,
      agentDir,
      scope: "project",
      defaultProvider: null,
      defaultModel: null,
      defaultThinkingLevel: null,
    });

    expect(snapshot.defaults.project).toEqual({
      defaultProvider: null,
      defaultModel: null,
      defaultThinkingLevel: null,
    });
    expect(snapshot.defaults.effective).toEqual({
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.4",
      defaultThinkingLevel: "medium",
    });

    const projectSettings = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8"));
    expect(projectSettings.defaultProvider).toBeUndefined();
    expect(projectSettings.defaultModel).toBeUndefined();
    expect(projectSettings.defaultThinkingLevel).toBeUndefined();
    expect(projectSettings.default_provider).toBeUndefined();
    expect(projectSettings.default_model).toBeUndefined();
    expect(projectSettings.default_thinking_level).toBeUndefined();
  });

  test("stores and clears shared API-key credentials", async () => {
    const { agentDir } = createTempWorkspace();

    await setPiApiKeyCredential({
      agentDir,
      providerId: "openai",
      key: "sk-test-123",
    });

    let snapshot = await getPiSettingsSnapshot({ agentDir, cwd: null });
    const openAiState = snapshot.providers.find((provider) => provider.id === "openai");

    expect(openAiState?.authStatus).toBe("api_key");
    expect(openAiState?.hasStoredAuth).toBe(true);

    await clearPiAuthCredential({
      agentDir,
      providerId: "openai",
    });

    snapshot = await getPiSettingsSnapshot({ agentDir, cwd: null });
    expect(snapshot.providers.find((provider) => provider.id === "openai")?.hasStoredAuth).toBe(
      false,
    );
  });

  test("picks up standalone Pi settings edits on the next snapshot refresh", async () => {
    const { agentDir, cwd } = createTempWorkspace();
    const globalSettingsPath = join(agentDir, "settings.json");
    const projectSettingsPath = join(cwd, ".pi", "settings.json");

    writeJson(globalSettingsPath, {
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.4",
      defaultThinkingLevel: "medium",
    });
    writeJson(projectSettingsPath, {
      defaultModel: "gpt-5.4-mini",
    });

    const initialSnapshot = await getPiSettingsSnapshot({ cwd, agentDir });

    expect(initialSnapshot.defaults.effective).toEqual({
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.4-mini",
      defaultThinkingLevel: "medium",
    });

    writeJson(globalSettingsPath, {
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-6",
      defaultThinkingLevel: "high",
    });
    writeJson(projectSettingsPath, {
      defaultModel: "claude-sonnet-4-6",
      defaultThinkingLevel: "minimal",
    });

    const refreshedSnapshot = await getPiSettingsSnapshot({ cwd, agentDir });

    expect(refreshedSnapshot.defaults.effective).toEqual({
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-6",
      defaultThinkingLevel: "minimal",
    });
  });
});
