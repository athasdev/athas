import { describe, expect, test } from "bun:test";
import {
  getAvailableThinkingLevels,
  getAvailableModelsForSession,
  getSessionModeState,
  listSlashCommandsForSession,
  reloadSessionResources,
  setSessionMode,
  setSessionModel,
  setSessionThinkingLevel,
} from "./session-runtime.mjs";

describe("pi-native session runtime helpers", () => {
  test("lists builtin, extension, prompt, and skill slash commands", () => {
    const session = {
      promptTemplates: [
        {
          name: "ship-it",
          description: "Prepare a clean release summary",
          source: "project",
          filePath: "/tmp/project/.pi/prompts/ship-it.md",
        },
      ],
      _extensionRunner: {
        getRegisteredCommandsWithPaths() {
          return [
            {
              command: {
                name: "deploy-preview",
                description: "Create a preview deploy",
              },
              extensionPath: "/tmp/extensions/deploy-preview.js",
            },
            {
              command: {
                name: "model",
                description: "Conflicts with builtin and should be skipped",
              },
              extensionPath: "/tmp/extensions/conflict.js",
            },
          ];
        },
      },
      _resourceLoader: {
        getSkills() {
          return {
            skills: [
              {
                name: "triage",
                description: "Debug production incidents",
                source: "user",
                filePath: "/tmp/skills/triage/SKILL.md",
              },
            ],
          };
        },
      },
    };

    expect(listSlashCommandsForSession(session)).toEqual(
      expect.arrayContaining([
        {
          name: "model",
          description: "Select model (opens selector UI)",
        },
        {
          name: "deploy-preview",
          description: "Create a preview deploy",
        },
        {
          name: "ship-it",
          description: "Prepare a clean release summary",
        },
        {
          name: "skill:triage",
          description: "Debug production incidents",
        },
      ]),
    );
  });

  test("reads and writes the shared native session mode", () => {
    const calls = [];
    const session = {
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      setSteeringMode(mode) {
        calls.push(["steering", mode]);
        this.steeringMode = mode;
      },
      setFollowUpMode(mode) {
        calls.push(["follow-up", mode]);
        this.followUpMode = mode;
      },
    };

    expect(getSessionModeState(session)).toEqual({
      currentModeId: "one-at-a-time",
      availableModes: [
        {
          id: "one-at-a-time",
          name: "One at a Time",
          description: "Deliver queued steering and follow-up messages one at a time.",
        },
        {
          id: "all",
          name: "All at Once",
          description: "Deliver queued steering and follow-up messages without waiting between them.",
        },
      ],
    });

    setSessionMode(session, "all");

    expect(calls).toEqual([
      ["steering", "all"],
      ["follow-up", "all"],
    ]);
    expect(getSessionModeState(session).currentModeId).toBe("all");
    expect(() => setSessionMode(session, "chat")).toThrow("Unsupported pi-native mode");
  });

  test("lists available models and applies model and thinking changes", async () => {
    const setModelCalls = [];
    const setThinkingCalls = [];
    const modelA = {
      provider: "openai-codex",
      id: "gpt-5.4",
      name: "GPT-5.4",
      reasoning: true,
    };
    const modelB = {
      provider: "openai-codex",
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      reasoning: true,
    };
    const session = {
      modelRegistry: {
        getAvailable() {
          return [modelA, modelB];
        },
        find(provider, modelId) {
          return [modelA, modelB].find((model) => {
            return model.provider === provider && model.id === modelId;
          });
        },
      },
      async setModel(model) {
        setModelCalls.push(model);
      },
      setThinkingLevel(level) {
        setThinkingCalls.push(level);
      },
    };

    expect(getAvailableModelsForSession(session)).toEqual([
      {
        provider: "openai-codex",
        modelId: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
      },
      {
        provider: "openai-codex",
        modelId: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        reasoning: true,
      },
    ]);

    await setSessionModel(session, {
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
    });
    setSessionThinkingLevel(session, "medium");

    expect(setModelCalls).toEqual([modelB]);
    expect(setThinkingCalls).toEqual(["medium"]);
    await expect(
      setSessionModel(session, {
        provider: "openai-codex",
        modelId: "missing",
      }),
    ).rejects.toThrow("Unknown pi-native model");

    expect(getAvailableThinkingLevels()).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("reloads session resources through the native session API", async () => {
    let reloadCalls = 0;
    const session = {
      async reload() {
        reloadCalls += 1;
      },
    };

    await reloadSessionResources(session);

    expect(reloadCalls).toBe(1);
  });
});
