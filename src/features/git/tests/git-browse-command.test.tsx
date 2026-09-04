import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GitBrowseCommand } from "../components/git-browse-command";
import { GIT_COMMAND_SECTIONS, GitCommandWorkspace } from "../components/git-command-surface";
import type { GitCommit, GitFile } from "../types/git.types";

const files: GitFile[] = [
  { path: "src/main.tsx", status: "modified", staged: true },
  { path: "src/main.tsx", status: "modified", staged: false },
  { path: "src/new-file.ts", status: "untracked", staged: false },
];
const commits: GitCommit[] = [
  { hash: "a123456789", message: "Improve Git navigation", author: "Ada", date: "2026-09-04" },
  { hash: "b123456789", message: "Fix editor", author: "Linus", date: "2026-09-03" },
];
const callbacks = { onClose: vi.fn(), onFileSelect: vi.fn(), onCommitSelect: vi.fn() };

describe("Git command browsing", () => {
  it("opens the selected staged version and closes the command window", () => {
    const onFileSelect = vi.fn();
    const onClose = vi.fn();
    const list = GitBrowseCommand({
      section: "changes",
      query: "main.tsx",
      files,
      commits,
      onFileSelect,
      onClose,
      onCommitSelect: vi.fn(),
    });
    list.props.children[1].props.onClick();
    expect(onFileSelect).toHaveBeenCalledWith(files[1]);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onFileSelect.mock.invocationCallOrder[0],
    );
  });

  it("opens the filtered history commit, not its original list index", () => {
    const onCommitSelect = vi.fn();
    const list = GitBrowseCommand({
      section: "history",
      query: "Linus",
      files,
      commits,
      onFileSelect: vi.fn(),
      onClose: vi.fn(),
      onCommitSelect,
    });
    list.props.children[0].props.onClick();
    expect(onCommitSelect).toHaveBeenCalledWith(commits[1]);
  });

  it("keeps staged and unstaged versions of the same file distinct", () => {
    const markup = renderToStaticMarkup(
      <GitBrowseCommand
        section="changes"
        query="main.tsx"
        files={files}
        commits={commits}
        {...callbacks}
      />,
    );
    expect(markup.match(/src\/main.tsx/g)).toHaveLength(2);
    expect(markup).toContain("Staged");
    expect(markup).toContain("Unstaged");
    expect(markup).not.toContain("new-file.ts");
  });

  it.each(["Ada", "a123456", "navigation"])("finds history by %s", (query) => {
    const markup = renderToStaticMarkup(
      <GitBrowseCommand
        section="history"
        query={query}
        files={files}
        commits={commits}
        {...callbacks}
      />,
    );
    expect(markup).toContain("Improve Git navigation");
    expect(markup).not.toContain("Fix editor");
  });

  it("distinguishes an empty repository from an unmatched search", () => {
    const empty = renderToStaticMarkup(
      <GitBrowseCommand section="changes" query="" files={[]} commits={[]} {...callbacks} />,
    );
    const filtered = renderToStaticMarkup(
      <GitBrowseCommand
        section="changes"
        query="missing"
        files={files}
        commits={commits}
        {...callbacks}
      />,
    );
    expect(empty).toContain("Working tree clean");
    expect(filtered).toContain("No matching changes");
  });

  it("opens each Git section in the shared workspace and leaves Review out", () => {
    expect(GIT_COMMAND_SECTIONS.map(({ id }) => id)).toEqual([
      "changes",
      "history",
      "remotes",
      "tags",
      "stashes",
    ]);
    const onSectionChange = vi.fn();
    const workspace = GitCommandWorkspace({
      section: "changes",
      query: "",
      onQueryChange: vi.fn(),
      onSectionChange,
      onClose: vi.fn(),
      children: null,
    });
    for (const item of workspace.props.headerAddon.props.items) {
      item.onSelect();
      expect(onSectionChange).toHaveBeenLastCalledWith(item.id);
    }
  });
});
