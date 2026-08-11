import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ATHAS_ROOT } from "@/extensions/tooling/extension-workspace";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import { CLAUDE_CODE_TERMINAL_AGENT_ID } from "@/features/ai/lib/claude-code";

async function readOfficialManifest(folder: string): Promise<ExtensionManifest> {
  return JSON.parse(
    await readFile(join(ATHAS_ROOT, "extensions", "official", folder, "extension.json"), "utf8"),
  ) as ExtensionManifest;
}

describe("agent extension manifests", () => {
  it("uses the current Claude Agent ACP adapter without replacing the terminal integration", async () => {
    const manifest = await readOfficialManifest("claude-code");

    expect(manifest).toMatchObject({
      id: "athas.agent.claude-acp",
      name: "Claude Agent",
      displayName: "Claude Agent",
    });
    expect(manifest.agents).toEqual([
      expect.objectContaining({
        id: "claude-acp",
        name: "Claude Agent",
        binaryName: "claude-agent-acp",
        install: expect.objectContaining({
          runtime: "node",
          package: "@agentclientprotocol/claude-agent-acp",
          command: "claude-agent-acp",
        }),
      }),
    ]);
    expect(CLAUDE_CODE_TERMINAL_AGENT_ID).toBe("claude-code");
    expect(manifest.agents?.[0]?.id).not.toBe(CLAUDE_CODE_TERMINAL_AGENT_ID);
  });
});
