import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ATHAS_ROOT } from "../../../extensions/tooling/extension-workspace";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import { CLAUDE_CODE_TERMINAL_AGENT_ID } from "@/features/ai/lib/claude-code";

async function readOfficialManifest(folder: string): Promise<ExtensionManifest> {
  return JSON.parse(
    await readFile(join(ATHAS_ROOT, "extensions", "official", folder, "extension.json"), "utf8"),
  ) as ExtensionManifest;
}

async function readOfficialIcon(folder: string): Promise<string> {
  return readFile(join(ATHAS_ROOT, "extensions", "official", folder, "icon.svg"), "utf8");
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
          package: "@agentclientprotocol/claude-agent-acp@0.73.0",
          version: "0.73.0",
          command: "claude-agent-acp",
        }),
      }),
    ]);
    expect(CLAUDE_CODE_TERMINAL_AGENT_ID).toBe("claude-code");
    expect(manifest.agents?.[0]?.id).not.toBe(CLAUDE_CODE_TERMINAL_AGENT_ID);
  });

  it("installs the current Kimi CLI release on every supported desktop target", async () => {
    const manifest = await readOfficialManifest("kimi-cli");
    const install = manifest.agents?.[0]?.install;

    expect(manifest).toMatchObject({
      id: "athas.agent.kimi-cli",
      name: "Kimi CLI",
    });
    expect(manifest.agents?.[0]).toMatchObject({
      args: ["acp"],
      binaryName: "kimi",
    });
    expect(install).toMatchObject({
      runtime: "binary",
      command: "kimi",
      downloadUrls: {
        "darwin-arm64": expect.stringContaining("/1.50.0/kimi-1.50.0-aarch64-apple-darwin"),
        "darwin-x64": expect.stringContaining("/1.50.0/kimi-1.50.0-x86_64-apple-darwin"),
        "linux-arm64": expect.stringContaining("/1.50.0/kimi-1.50.0-aarch64-unknown-linux-gnu"),
        "linux-x64": expect.stringContaining("/1.50.0/kimi-1.50.0-x86_64-unknown-linux-gnu"),
        "win32-arm64": expect.stringContaining("/1.50.0/kimi-1.50.0-aarch64-pc-windows-msvc"),
        "win32-x64": expect.stringContaining("/1.50.0/kimi-1.50.0-x86_64-pc-windows-msvc"),
      },
    });
  });

  it("installs GitHub Copilot through its native ACP server", async () => {
    const manifest = await readOfficialManifest("github-copilot");

    expect(manifest).toMatchObject({
      id: "athas.agent.github-copilot",
      name: "GitHub Copilot",
      publisher: "GitHub",
    });
    expect(manifest.agents).toEqual([
      expect.objectContaining({
        id: "github-copilot-cli",
        binaryName: "copilot",
        args: ["--acp"],
        install: expect.objectContaining({
          runtime: "node",
          package: "@github/copilot@1.0.82",
          version: "1.0.82",
          command: "copilot",
        }),
      }),
    ]);
  });

  it("keeps Gemini CLI for supported enterprise and API-key access", async () => {
    const manifest = await readOfficialManifest("gemini-cli");

    expect(manifest).toMatchObject({
      id: "athas.agent.gemini-cli",
      name: "Gemini CLI",
      publisher: "Google",
    });
    expect(manifest.agents).toEqual([
      expect.objectContaining({
        id: "gemini-cli",
        binaryName: "gemini",
        args: ["--acp"],
        install: expect.objectContaining({
          runtime: "node",
          package: "@google/gemini-cli@0.58.0",
          version: "0.58.0",
          command: "gemini",
        }),
      }),
    ]);
  });

  it("ships Google's official Antigravity ACP server for supported platforms", async () => {
    const manifest = await readOfficialManifest("antigravity");

    expect(manifest).toMatchObject({
      id: "athas.agent.antigravity",
      name: "Google Antigravity",
      publisher: "Google",
    });
    expect(manifest.agents?.[0]).toMatchObject({
      id: "antigravity-acp",
      binaryName: "agy_acp_server",
      argsByPlatform: {
        "linux-arm64": ["--uid="],
        "linux-x64": ["--uid="],
      },
      install: {
        runtime: "binary",
        version: "1.0.0",
        command: "agy_acp_server.par",
        commandsByPlatform: expect.objectContaining({
          "darwin-arm64": "agy_acp_server.par",
          "win32-x64": "agy_acp_server.exe",
        }),
        downloadUrls: expect.objectContaining({
          "darwin-arm64": expect.stringContaining("dl.google.com/agy-extensions/releases"),
          "win32-x64": expect.stringContaining("agy-acp-server"),
        }),
      },
    });
  });

  it("ships distinct brand artwork instead of the generic agent placeholder", async () => {
    const folders = ["antigravity", "gemini-cli", "kimi-cli", "opencode", "qwen-code"];
    const icons = await Promise.all(folders.map(readOfficialIcon));

    for (const [index, icon] of icons.entries()) {
      expect(icon).toContain(`data-brand="${folders[index]}"`);
      expect(icon).not.toContain("M12.3333 3");
    }

    expect(new Set(icons).size).toBe(folders.length);
  });
});
