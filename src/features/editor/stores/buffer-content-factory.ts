import { detectLanguageFromFileName } from "@/features/editor/utils/language-detection";
import type { OpenContentSpec, PaneContent } from "@/features/panes/types/pane-content";

export const createPaneContent = (id: string, spec: OpenContentSpec): PaneContent => {
  const base = {
    id,
    isPinned: false,
    isActive: true,
  };

  switch (spec.type) {
    case "editor":
      return {
        ...base,
        type: "editor",
        path: spec.path,
        name: spec.name,
        content: spec.content,
        savedContent: spec.content,
        isDirty: false,
        isVirtual: spec.isVirtual ?? false,
        isPreview: spec.isPreview ?? false,
        language: spec.language ?? detectLanguageFromFileName(spec.name),
        tokens: [],
      };
    case "terminal": {
      const sessionId = spec.sessionId ?? id.replace("buffer_", "");
      return {
        ...base,
        type: "terminal",
        path: spec.path ?? `terminal://${sessionId}`,
        name: spec.name ?? "Terminal",
        isPreview: false,
        sessionId,
        initialCommand: spec.command,
        workingDirectory: spec.workingDirectory,
        remoteConnectionId: spec.remoteConnectionId,
      };
    }
    case "agent":
      return {
        ...base,
        type: "agent",
        path: `agent://${spec.sessionId ?? id}`,
        name: "Agent",
        isPreview: false,
        sessionId: spec.sessionId ?? id.replace("buffer_", ""),
      };
    case "webViewer":
      return {
        ...base,
        type: "webViewer",
        path: `web-viewer://${spec.url}`,
        name: "Web Viewer",
        isPreview: false,
        url: spec.url,
        zoomLevel: spec.zoomLevel,
      };
    case "newTab":
      return {
        ...base,
        type: "newTab",
        path: `newtab://${id}`,
        name: "New Tab",
        isPreview: false,
      };
    case "diff":
      return {
        ...base,
        type: "diff",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        content: spec.content,
        savedContent: spec.content,
        diffData: spec.diffData,
      };
    case "image":
      return {
        ...base,
        type: "image",
        path: spec.path,
        name: spec.name,
        isPreview: false,
      };
    case "pdf":
      return {
        ...base,
        type: "pdf",
        path: spec.path,
        name: spec.name,
        isPreview: false,
      };
    case "binary":
      return {
        ...base,
        type: "binary",
        path: spec.path,
        name: spec.name,
        isPreview: false,
      };
    case "database":
      return {
        ...base,
        type: "database",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        databaseType: spec.databaseType,
        connectionId: spec.connectionId,
      };
    case "pullRequest":
      return {
        ...base,
        type: "pullRequest",
        path: spec.selectedFilePath
          ? `pr://${spec.prNumber}?file=${encodeURIComponent(spec.selectedFilePath)}`
          : `pr://${spec.prNumber}`,
        name: spec.name ?? "Pull Request",
        isPreview: false,
        prNumber: spec.prNumber,
        authorAvatarUrl: spec.authorAvatarUrl,
      };
    case "githubIssue":
      return {
        ...base,
        type: "githubIssue",
        path: spec.url ?? `github-issue://${spec.issueNumber}`,
        name: spec.name ?? "Issue",
        isPreview: false,
        repoPath: spec.repoPath,
        issueNumber: spec.issueNumber,
        authorAvatarUrl: spec.authorAvatarUrl,
        url: spec.url,
      };
    case "githubAction":
      return {
        ...base,
        type: "githubAction",
        path: spec.url ?? `github-action://${spec.runId}`,
        name: spec.name ?? "Action",
        isPreview: false,
        repoPath: spec.repoPath,
        runId: spec.runId,
        url: spec.url,
      };
    case "markdownPreview":
      return {
        ...base,
        type: "markdownPreview",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "htmlPreview":
      return {
        ...base,
        type: "htmlPreview",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "csvPreview":
      return {
        ...base,
        type: "csvPreview",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "externalEditor":
      return {
        ...base,
        type: "externalEditor",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        terminalConnectionId: spec.terminalConnectionId,
      };
    case "globalSearch":
      return {
        ...base,
        type: "globalSearch",
        path: "search://global",
        name: "Search",
        isPreview: false,
      };
    case "diagnostics":
      return {
        ...base,
        type: "diagnostics",
        path: "diagnostics://problems",
        name: "Diagnostics",
        isPreview: false,
      };
  }
};
