import { describe, expect, it } from "vite-plus/test";
import {
  findModeForIntent,
  getChatModeSource,
  getNextModeOption,
  inferModeIntent,
} from "@/features/ai/lib/composer-modes";
import type { AcpSessionState } from "@/features/ai/types/acp.types";

function session(overrides: Partial<AcpSessionState> = {}): AcpSessionState {
  return {
    slashCommands: [],
    modeState: { currentModeId: null, availableModes: [] },
    configOptions: [],
    usage: null,
    ...overrides,
  };
}

const claudeModes = [
  { id: "default", name: "Default" },
  { id: "acceptEdits", name: "Accept Edits" },
  { id: "plan", name: "Plan Mode" },
  { id: "bypassPermissions", name: "Bypass Permissions" },
];

describe("Composer modes", () => {
  it("offers Agent, Ask and Plan for the built-in agent", () => {
    const source = getChatModeSource({
      agentId: "custom",
      builtInMode: "ask",
      acpSession: session(),
      acpSessionId: null,
    });
    expect(source.options.map((option) => option.label)).toEqual(["Agent", "Ask", "Plan"]);
    expect(source.currentId).toBe("ask");
    expect(getNextModeOption(source)?.id).toBe("plan");
    expect(getNextModeOption({ ...source, currentId: "plan" })?.id).toBe("chat");
  });

  it("reads an ACP agent's own session modes and maps the slash intents onto them", () => {
    const source = getChatModeSource({
      agentId: "claude-code",
      builtInMode: "chat",
      acpSession: session({
        modeState: { currentModeId: "plan", availableModes: claudeModes },
      }),
      acpSessionId: "session-1",
    });
    expect(source.kind).toBe("acp-mode");
    expect(source.currentId).toBe("plan");
    expect(findModeForIntent(source, "plan")?.id).toBe("plan");
    expect(findModeForIntent(source, "agent")?.id).toBe("default");
    expect(findModeForIntent(source, "ask")).toBeNull();
  });

  it("prefers a mode config option when the agent exposes one", () => {
    const source = getChatModeSource({
      agentId: "codex-acp",
      builtInMode: "chat",
      acpSession: session({
        configOptions: [
          {
            id: "approval",
            name: "Mode",
            category: "mode",
            kind: {
              type: "select",
              currentValue: "auto",
              options: [
                { id: "read-only", name: "Read Only" },
                { id: "auto", name: "Auto" },
                { id: "full-access", name: "Full Access" },
              ],
            },
          },
        ],
      }),
      acpSessionId: "session-2",
    });
    expect(source).toMatchObject({ kind: "acp-config", configOptionId: "approval" });
    expect(findModeForIntent(source, "ask")?.id).toBe("read-only");
    expect(findModeForIntent(source, "agent")?.id).toBe("auto");
  });

  it("does not read a negated ask as the ask mode", () => {
    expect(inferModeIntent({ id: "dontAsk", name: "Don't Ask" })).toBeNull();
    expect(inferModeIntent({ id: "ask", name: "Ask" })).toBe("ask");
  });

  it("has nothing to cycle when the agent offers one mode or none", () => {
    const source = getChatModeSource({
      agentId: "gemini",
      builtInMode: "chat",
      acpSession: session(),
      acpSessionId: null,
    });
    expect(source.options).toEqual([]);
    expect(getNextModeOption(source)).toBeNull();
  });
});
