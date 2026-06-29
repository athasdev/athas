import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { buildWslPath, parseWslPath } from "@/features/wsl/utils/wsl-path";
import { joinPath } from "@/utils/path-helpers";

export interface TerminalFileLink {
  text: string;
  path: string;
  line?: number;
  column?: number;
  startIndex: number;
  endIndex: number;
}

const LEADING_TRIM_RE = /^[`"'(<[{]+/;
const TRAILING_TRIM_RE = /[`"')>\]},.;!:]+$/;
const LINE_COLUMN_RE = /^(.*?)(?::(\d+))(?::(\d+))?$/;
const SUPPORTED_URI_RE = /^(file|remote|wsl):\/\//i;
const UNSUPPORTED_URI_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;
const EXTENSIONLESS_FILENAMES = new Set([
  "AGENTS",
  "Brewfile",
  "Dockerfile",
  "Gemfile",
  "Justfile",
  "LICENSE",
  "Makefile",
  "Procfile",
  "Rakefile",
  "README",
]);

function trimToken(rawToken: string, tokenStart: number) {
  let text = rawToken;
  let startIndex = tokenStart;

  const leadingMatch = text.match(LEADING_TRIM_RE);
  if (leadingMatch?.[0]) {
    text = text.slice(leadingMatch[0].length);
    startIndex += leadingMatch[0].length;
  }

  text = text.replace(TRAILING_TRIM_RE, "");

  return {
    text,
    startIndex,
    endIndex: startIndex + text.length,
  };
}

function decodeFileUri(path: string) {
  if (!path.toLowerCase().startsWith("file://")) return path;

  try {
    const url = new URL(path);
    if (url.protocol !== "file:") return path;
    return decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:\/)/, "$1"));
  } catch {
    return path.slice("file://".length);
  }
}

function extractLineColumn(text: string) {
  const match = text.match(LINE_COLUMN_RE);
  if (!match) return { path: text };

  const [, path, lineText, columnText] = match;
  if (!path || WINDOWS_ABSOLUTE_RE.test(text)) {
    if (WINDOWS_ABSOLUTE_RE.test(text) && !lineText) return { path: text };
  }

  return {
    path,
    line: Number(lineText),
    column: columnText ? Number(columnText) : undefined,
  };
}

function getBaseName(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? "";
}

function hasPathShape(path: string) {
  if (SUPPORTED_URI_RE.test(path)) return true;
  if (path.startsWith("/") || WINDOWS_ABSOLUTE_RE.test(path)) return true;
  if (path.startsWith("./") || path.startsWith("../")) return true;
  return path.includes("/") || path.includes("\\");
}

function hasFileNameShape(path: string) {
  const baseName = getBaseName(path);
  if (!baseName || baseName === "." || baseName === "..") return false;
  if (baseName.includes(".")) return true;
  return EXTENSIONLESS_FILENAMES.has(baseName);
}

function isAbsoluteLikePath(path: string) {
  return (
    path.startsWith("/") ||
    WINDOWS_ABSOLUTE_RE.test(path) ||
    /^remote:\/\//i.test(path) ||
    /^wsl:\/\//i.test(path)
  );
}

function resolveProviderAbsolutePath(path: string, workspaceRoot: string | undefined) {
  if (!path.startsWith("/") || !workspaceRoot) return null;

  const remoteRoot = parseRemotePath(workspaceRoot);
  if (remoteRoot) return `remote://${remoteRoot.connectionId}${path}`;

  const wslRoot = parseWslPath(workspaceRoot);
  if (wslRoot) return buildWslPath(wslRoot.distro, path);

  return null;
}

function resolveCandidatePath(path: string, workspaceRoot: string | undefined) {
  if (UNSUPPORTED_URI_RE.test(path) && !SUPPORTED_URI_RE.test(path)) return null;

  const decodedPath = decodeFileUri(path);
  if (!hasPathShape(decodedPath) || !hasFileNameShape(decodedPath)) return null;
  const providerAbsolutePath = resolveProviderAbsolutePath(decodedPath, workspaceRoot);
  if (providerAbsolutePath) return providerAbsolutePath;
  if (isAbsoluteLikePath(decodedPath)) return decodedPath;
  if (!workspaceRoot) return null;

  return joinPath(workspaceRoot, decodedPath.replace(/^\.\//, ""));
}

export function parseTerminalFileLinks(
  lineText: string,
  workspaceRoot: string | undefined,
): TerminalFileLink[] {
  const links: TerminalFileLink[] = [];
  const tokenRe = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(lineText))) {
    const token = trimToken(match[0], match.index);
    if (!token.text) continue;

    const { path, line, column } = extractLineColumn(token.text);
    const resolvedPath = resolveCandidatePath(path, workspaceRoot);
    if (!resolvedPath) continue;

    links.push({
      text: token.text,
      path: resolvedPath,
      line,
      column,
      startIndex: token.startIndex,
      endIndex: token.endIndex,
    });
  }

  return links;
}
