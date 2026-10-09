import { describe, expect, it } from "vite-plus/test";
import { parseMcpInstallLink } from "@/features/ai/services/mcp-install-link";

function link(name: string, config: unknown) {
  const encoded = btoa(JSON.stringify(config));
  return new URL(
    `athas://mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(encoded)}`,
  );
}

describe("parseMcpInstallLink", () => {
  it("reads a local server in the Cursor link format", () => {
    expect(
      parseMcpInstallLink(
        link("Filesystem", {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp", 3],
          env: { DEBUG: "1", IGNORED: 2 },
        }),
      ),
    ).toMatchObject({
      id: null,
      name: "Filesystem",
      transport: "stdio",
      command: "npx",
      argsText: "-y\n@modelcontextprotocol/server-filesystem\n/tmp",
      env: [{ name: "DEBUG", value: "1" }],
    });
  });

  it("reads remote servers and their transport", () => {
    expect(
      parseMcpInstallLink(
        link("Docs", { url: "https://mcp.example.com/sse", type: "sse", headers: { A: "b" } }),
      ),
    ).toMatchObject({
      transport: "sse",
      url: "https://mcp.example.com/sse",
      headers: [{ name: "A", value: "b" }],
    });
    expect(parseMcpInstallLink(link("Docs", { url: "https://mcp.example.com/mcp" }))).toMatchObject(
      { transport: "http" },
    );
  });

  it("accepts URL-safe base64 without padding", () => {
    const encoded = btoa(JSON.stringify({ command: "uvx", args: ["mcp-server-fetch?"] }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const url = new URL(`athas://mcp/install?name=Fetch&config=${encoded}`);
    expect(parseMcpInstallLink(url)?.command).toBe("uvx");
  });

  it("restores plus signs from unescaped standard base64", () => {
    const config = { command: "node", args: ["~~~>"] };
    const encoded = btoa(JSON.stringify(config));
    expect(encoded).toContain("+");
    const url = new URL(`athas://mcp/install?name=Node&config=${encoded}`);
    expect(parseMcpInstallLink(url)?.argsText).toBe("~~~>");
  });

  it("rejects links without a usable server", () => {
    expect(parseMcpInstallLink(new URL("athas://mcp/install?name=Empty"))).toBeNull();
    expect(parseMcpInstallLink(link("", { command: "npx" }))).toBeNull();
    expect(parseMcpInstallLink(link("Bad", { url: "file:///etc/passwd" }))).toBeNull();
    expect(parseMcpInstallLink(link("Bad", ["npx"]))).toBeNull();
    expect(parseMcpInstallLink(new URL("athas://mcp/install?name=Bad&config=not-json"))).toBeNull();
  });
});
