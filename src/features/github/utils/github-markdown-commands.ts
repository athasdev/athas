export type GitHubMarkdownCommandId =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "quote"
  | "bullet-list"
  | "numbered-list"
  | "task-list"
  | "code-block"
  | "divider"
  | "table";

export type GitHubMarkdownCommandGroup = "basic blocks" | "lists" | "insert";

export interface GitHubMarkdownCommandDefinition {
  id: GitHubMarkdownCommandId;
  label: string;
  group: GitHubMarkdownCommandGroup;
  keywords: string[];
}

export const GITHUB_MARKDOWN_COMMANDS: GitHubMarkdownCommandDefinition[] = [
  {
    id: "paragraph",
    label: "text",
    group: "basic blocks",
    keywords: ["paragraph", "plain", "text"],
  },
  {
    id: "heading-1",
    label: "heading 1",
    group: "basic blocks",
    keywords: ["h1", "title", "heading"],
  },
  {
    id: "heading-2",
    label: "heading 2",
    group: "basic blocks",
    keywords: ["h2", "subtitle", "heading"],
  },
  {
    id: "heading-3",
    label: "heading 3",
    group: "basic blocks",
    keywords: ["h3", "subheading", "heading"],
  },
  {
    id: "quote",
    label: "quote",
    group: "basic blocks",
    keywords: ["blockquote", "citation", "quote"],
  },
  {
    id: "bullet-list",
    label: "bulleted list",
    group: "lists",
    keywords: ["bullet", "unordered", "list"],
  },
  {
    id: "numbered-list",
    label: "numbered list",
    group: "lists",
    keywords: ["number", "numbered", "ordered", "list"],
  },
  {
    id: "task-list",
    label: "task list",
    group: "lists",
    keywords: ["todo", "task", "check", "checkbox", "list"],
  },
  {
    id: "code-block",
    label: "code block",
    group: "insert",
    keywords: ["code", "fence", "snippet", "pre", "syntax"],
  },
  {
    id: "divider",
    label: "divider",
    group: "insert",
    keywords: ["divider", "separator", "rule", "horizontal"],
  },
  {
    id: "table",
    label: "table",
    group: "insert",
    keywords: ["table", "grid", "columns", "rows"],
  },
];

export function filterGitHubMarkdownCommands(query: string): GitHubMarkdownCommandDefinition[] {
  const normalizedQuery = query.trim().replace(/^\/+/, "").toLocaleLowerCase();
  if (!normalizedQuery) return GITHUB_MARKDOWN_COMMANDS;

  return GITHUB_MARKDOWN_COMMANDS.filter((command) =>
    [command.label, ...command.keywords].some((candidate) =>
      candidate.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
}
