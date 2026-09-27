import { describe, expect, it } from "vite-plus/test";
import { parseMcpToolName, toMcpToolName } from "@/features/ai/lib/mcp-tool-name";

describe("MCP tool names", () => {
  it("namespaces a tool by its server and splits it back", () => {
    const name = toMcpToolName("My GitHub", "create_issue");
    expect(name).toBe("mcp__My_GitHub__create_issue");
    expect(parseMcpToolName(name)).toEqual({ server: "My_GitHub", tool: "create_issue" });
  });

  it("keeps server names free of the separator and within provider limits", () => {
    expect(toMcpToolName("a__b", "x.y")).toBe("mcp__a_b__x_y");
    expect(toMcpToolName("server", "t".repeat(100))).toHaveLength(64);
  });

  it("leaves other tool names alone", () => {
    expect(parseMcpToolName("read_file")).toBeNull();
    expect(parseMcpToolName("mcp__custom")).toBeNull();
  });
});
