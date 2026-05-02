export interface EnvTemplateTarget {
  id: string;
  label: string;
  fileName: string;
}

export const ENV_TEMPLATE_TARGETS: EnvTemplateTarget[] = [
  { id: "env-example", label: "Create .env.example", fileName: ".env.example" },
  { id: "env-local", label: "Create .env.local", fileName: ".env.local" },
  { id: "env-development", label: "Create .env.development", fileName: ".env.development" },
];

const ENV_ASSIGNMENT_PATTERN = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.*)$/;

export function isEnvFileName(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  return normalized === ".env" || normalized.startsWith(".env.");
}

function findInlineCommentStart(value: string): number {
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && quote === '"') {
      escaped = true;
      continue;
    }

    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }

    if (char === "#" && !quote && (index === 0 || /\s/.test(value[index - 1] || ""))) {
      return index === 0 ? index : index - 1;
    }
  }

  return -1;
}

export function buildEnvTemplateContent(content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (hasTrailingNewline) lines.pop();

  const templatedLines = lines.map((line) => {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      return line;
    }

    const assignment = line.match(ENV_ASSIGNMENT_PATTERN);
    if (!assignment) {
      return line;
    }

    const [, prefix, value] = assignment;
    const commentStart = findInlineCommentStart(value);
    const comment = commentStart >= 0 ? value.slice(commentStart) : "";
    return `${prefix}${comment}`;
  });

  return `${templatedLines.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}

export function normalizeEnvTargetFileName(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) return null;

  const lower = trimmed.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) {
    return trimmed;
  }

  if (lower === "env" || lower.startsWith("env.")) {
    return `.${trimmed}`;
  }

  const suffix = trimmed.replace(/^\.+/, "");
  return suffix ? `.env.${suffix}` : null;
}
