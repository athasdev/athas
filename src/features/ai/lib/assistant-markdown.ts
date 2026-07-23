const CODE_LINE_PATTERN =
  /[{}()[\];]|=>|::|->|:=|==|!=|<=|>=|&&|\|\||^\s{2,}\S|^(let|const|var|fn|def|class|import|export|if|for|while|match|return|use|pub|impl|SELECT|FROM|INSERT|UPDATE|DELETE)\b/i;

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
