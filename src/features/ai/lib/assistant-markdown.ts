import { normalizeLanguage } from "@/features/editor/markdown/language-map";

const CODE_LINE_PATTERN =
  /[{}()[\];]|=>|::|->|:=|==|!=|<=|>=|&&|\|\||^\s{2,}\S|^(let|const|var|fn|def|class|import|export|if|for|while|match|return|use|pub|impl|SELECT|FROM|INSERT|UPDATE|DELETE)\b/i;

const LANGUAGE_HINTS = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "diff",
  "docker",
  "elixir",
  "erlang",
  "go",
  "graphql",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "lua",
  "makefile",
  "markdown",
  "markup",
  "nginx",
  "objectivec",
  "perl",
  "php",
  "python",
  "r",
  "ruby",
  "rust",
  "scala",
  "scss",
  "shell",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "vim",
  "xml",
  "yaml",
]);

function isLikelySourceCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>)/.test(trimmed)) return false;

  const wordCount = trimmed.split(/\s+/).length;
  return wordCount < 5 && CODE_LINE_PATTERN.test(line);
}

export function normalizePlainTextFence(text: string): string {
  const match = text
    .trim()
    .match(/^```(?:text|plaintext|markdown)?[ \t]*\n([\s\S]*?)\n```[ \t]*$/i);
  if (!match) return text;

  const body = match[1].trim();
  const contentLines = body.split("\n").filter((line) => line.trim().length > 0);
  if (contentLines.length === 0 || contentLines.some(isLikelySourceCodeLine)) return text;

  return body;
}

function getLanguageHint(line: string): string | null {
  const candidate = line
    .trim()
    .replace(/^(["'`“”‘’])+/, "")
    .replace(/(["'`“”‘’])+$/, "")
    .replace(/[:;,]$/, "")
    .trim();
  if (!/^[A-Za-z][A-Za-z0-9+#._-]{0,19}$/.test(candidate)) return null;

  const normalized = normalizeLanguage(candidate);
  return LANGUAGE_HINTS.has(normalized) ? normalized : null;
}

function isLikelyImplicitCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || /^(#{1,6}\s|[-*+]\s|\d+\.\s|>)/.test(trimmed)) return false;
  return CODE_LINE_PATTERN.test(line);
}

export function normalizeImplicitCodeFences(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const languageHint = getLanguageHint(lines[index]);
    const nextLine = lines[index + 1];

    if (!languageHint || nextLine === undefined || !isLikelyImplicitCodeLine(nextLine)) {
      output.push(lines[index]);
      continue;
    }

    output.push(`\`\`\`${languageHint}`);
    index += 1;

    while (index < lines.length) {
      const current = lines[index];
      const trimmed = current.trim();
      if (!trimmed || trimmed === '"' || trimmed === "'") {
        break;
      }
      output.push(current);
      index += 1;
    }

    output.push("```");
    if (index < lines.length && lines[index].trim() === "") {
      output.push("");
    }
  }

  return output.join("\n");
}
