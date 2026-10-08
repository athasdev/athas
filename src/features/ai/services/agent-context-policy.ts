import ignore from "ignore";
import type { ContextInfo } from "../types/ai-context.types";
import type { ProjectRuleReader } from "../types/project-rules.types";
import { getRelativePath, joinPath, normalizePath, pathStartsWithRoot } from "@/utils/path-helpers";

export type AgentContextPathPolicy = (path: string, isDirectory?: boolean) => boolean;
const AI_IGNORE_FILES = [".athasignore", ".aiignore", ".cursorignore"];
const EXCLUDED_COMPONENT = /^\.git$|^\.env($|\.)|\.(pem|key|p12|pfx)$|^id_(rsa|ed25519|ecdsa|dsa)/i;

export async function loadAgentContextPolicy(
  projectRoot?: string,
  reader?: ProjectRuleReader,
): Promise<AgentContextPathPolicy> {
  const matchers: ReturnType<typeof ignore>[] = [];
  if (projectRoot) {
    const io = reader ?? (await defaultReader(projectRoot));
    const entries = await io.readDirectory(projectRoot);
    for (const name of AI_IGNORE_FILES) {
      const entry = entries.find((item) => item.name === name);
      if (!entry) continue;
      if (entry.isDir || entry.isSymlink) throw new Error(`${name} must be a text file.`);
      const content = await io.readText(joinPath(projectRoot, name));
      if (content.length > 256 * 1024) throw new Error(`${name} is too large to load.`);
      matchers.push(ignore().add(content));
    }
  }
  return (path, isDirectory = false) => {
    const normalized = normalizePath(path);
    if (normalized.split("/").some((part) => part === ".." || EXCLUDED_COMPONENT.test(part)))
      return false;
    if (!projectRoot || !pathStartsWithRoot(normalized, projectRoot)) return true;
    const relative = getRelativePath(normalized, projectRoot).replace(/^\.\//, "");
    if (!relative) return true;
    return !matchers.some((matcher) => matcher.ignores(`${relative}${isDirectory ? "/" : ""}`));
  };
}

async function defaultReader(projectRoot: string): Promise<ProjectRuleReader> {
  const { getWorkspaceResourceProvider } =
    await import("@/features/file-system/services/workspace-resource-provider");
  const provider = getWorkspaceResourceProvider(projectRoot);
  return {
    readDirectory: (path) => provider.readDirectory(path, projectRoot),
    readText: (path) => provider.readText(path),
  };
}

export function filterAgentContext(
  context: ContextInfo,
  allows: AgentContextPathPolicy,
): ContextInfo {
  return {
    ...context,
    activeBuffer:
      context.activeBuffer && allows(context.activeBuffer.path) ? context.activeBuffer : undefined,
    openBuffers: context.openBuffers?.filter((buffer) => allows(buffer.path)),
    selectedProjectFiles: context.selectedProjectFiles?.filter((path) => allows(path)),
    mentionedFiles: context.mentionedFiles?.filter((file) => allows(file.path)),
    editorSelections: context.editorSelections?.filter((selection) => allows(selection.filePath)),
  };
}
