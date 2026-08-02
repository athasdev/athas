import { describe, expect, it } from "vite-plus/test";
import {
  GITHUB_MARKDOWN_COMMANDS,
  filterGitHubMarkdownCommands,
} from "../utils/github-markdown-commands";

describe("GitHub Markdown slash commands", () => {
  it("shows every command for an empty query in the designed order", () => {
    expect(filterGitHubMarkdownCommands("")).toEqual(GITHUB_MARKDOWN_COMMANDS);
    expect(filterGitHubMarkdownCommands("/")).toEqual(GITHUB_MARKDOWN_COMMANDS);
  });

  it("matches labels and familiar aliases", () => {
    expect(filterGitHubMarkdownCommands("h2").map((command) => command.id)).toEqual(["heading-2"]);
    expect(filterGitHubMarkdownCommands("todo").map((command) => command.id)).toEqual([
      "task-list",
    ]);
    expect(filterGitHubMarkdownCommands("syntax").map((command) => command.id)).toEqual([
      "code-block",
    ]);
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(filterGitHubMarkdownCommands("  /TABLE ").map((command) => command.id)).toEqual([
      "table",
    ]);
  });

  it("keeps command ids unique", () => {
    const ids = GITHUB_MARKDOWN_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every visible command label lowercase", () => {
    for (const command of GITHUB_MARKDOWN_COMMANDS) {
      expect(command.label).toBe(command.label.toLocaleLowerCase());
      expect(command.group).toBe(command.group.toLocaleLowerCase());
    }
  });
});
