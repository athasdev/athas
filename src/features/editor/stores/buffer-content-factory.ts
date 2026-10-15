import { detectLanguageFromFileName } from "@/features/editor/services/language-detection";
import {
  deliveryBufferPath,
  getViewBufferPath,
} from "@/features/editor/services/virtual-buffer-paths";
import { SINGLETON_TOOL_BUFFER_METADATA } from "@/features/panes/constants/tool-buffers";
import type { OpenContentSpec, PaneContent } from "@/features/panes/types/pane-content.types";

export const createPaneContent = (id: string, spec: OpenContentSpec): PaneContent => {
  const base = { id };

  switch (spec.type) {
    case "editor":
      return {
        ...base,
        type: "editor",
        path: spec.path,
        name: spec.name,
        content: spec.content,
        contentRevision: 0,
        savedContent: spec.content,
        isDirty: false,
        isVirtual: spec.isVirtual ?? false,
        readOnly: spec.readOnly,
        language: spec.language ?? detectLanguageFromFileName(spec.name),
      };
    case "terminal": {
      const sessionId = spec.sessionId ?? id.replace("buffer_", "");
      return {
        ...base,
        type: "terminal",
        path: spec.path ?? `terminal://${sessionId}`,
        name: spec.name ?? "Terminal",
        sessionId,
        shell: spec.shell,
        initialCommand: spec.command,
        workingDirectory: spec.workingDirectory,
        remoteConnectionId: spec.remoteConnectionId,
      };
    }
    case "browser":
      return {
        ...base,
        type: "browser",
        path: spec.path ?? `browser://${id}`,
        name: spec.name ?? "New Tab",
        url: spec.url ?? "about:blank",
        zoom: spec.zoom,
      };
    case "agent":
      return {
        ...base,
        type: "agent",
        path: `agent://${spec.sessionId ?? id}`,
        name: "Agent",
        sessionId: spec.sessionId ?? id.replace("buffer_", ""),
      };
    case "newTab":
      return {
        ...base,
        type: "newTab",
        path: `newtab://${id}`,
        name: "New Tab",
      };
    case "diff":
      return {
        ...base,
        type: "diff",
        path: spec.path,
        name: spec.name,
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
      };
    case "pdf":
      return {
        ...base,
        type: "pdf",
        path: spec.path,
        name: spec.name,
      };
    case "binary":
      return {
        ...base,
        type: "binary",
        path: spec.path,
        name: spec.name,
      };
    case "database":
      return {
        ...base,
        type: "database",
        path: spec.path,
        name: spec.name,
        databaseType: spec.databaseType,
        connectionId: spec.connectionId,
      };
    case "pullRequest":
      return {
        ...base,
        type: "pullRequest",
        path: spec.selectedFilePath
          ? `pr://${spec.prNumber}?file=${encodeURIComponent(spec.selectedFilePath)}`
          : spec.initialView === "files"
            ? `pr://${spec.prNumber}?view=files`
            : `pr://${spec.prNumber}`,
        name: spec.name ?? "Pull Request",
        repoPath: spec.repoPath,
        prNumber: spec.prNumber,
        authorAvatarUrl: spec.authorAvatarUrl,
      };
    case "githubIssue":
      return {
        ...base,
        type: "githubIssue",
        path: spec.url ?? `github-issue://${spec.issueNumber}`,
        name: spec.name ?? "Issue",
        repoPath: spec.repoPath,
        issueNumber: spec.issueNumber,
        authorAvatarUrl: spec.authorAvatarUrl,
        url: spec.url,
      };
    case "githubDelivery":
      return {
        ...base,
        type: "githubDelivery",
        kind: spec.kind,
        repoPath: spec.repoPath,
        resourceId: spec.resourceId,
        name: spec.name ?? (spec.kind === "releases" ? "New Release" : "Deployment"),
        path: deliveryBufferPath(spec.kind, spec.repoPath, spec.resourceId ?? "new"),
      };
    case "githubAction":
      return {
        ...base,
        type: "githubAction",
        path:
          spec.runId !== undefined
            ? (spec.url ?? `github-action://${spec.runId}`)
            : `github-action-notification://${spec.notification?.id ?? id}`,
        name: spec.name ?? "Action",
        repoPath: spec.repoPath,
        runId: spec.runId,
        notification: spec.notification,
        url: spec.url,
      };
    case "githubForm": {
      const resourceLabel =
        spec.formKind === "pull-request"
          ? "Pull Request"
          : spec.formKind === "issue"
            ? "Issue"
            : "Workflow";
      return {
        ...base,
        type: "githubForm",
        path: `github-form://create/${spec.formKind}/${encodeURIComponent(spec.repoPath)}`,
        name: spec.formKind === "action" ? "Run Workflow" : `New ${resourceLabel}`,
        repoPath: spec.repoPath,
        formKind: spec.formKind,
        operation: "create",
        defaultHead: spec.defaultHead,
      };
    }
    case "customView":
      return {
        ...base,
        type: "customView",
        path: getViewBufferPath(spec.projectPath, spec.viewId),
        name: spec.name ?? (spec.viewId ? "Custom View" : "New Custom View"),
        projectPath: spec.projectPath,
        viewId: spec.viewId,
      };
    case "markdownDocument":
      return {
        ...base,
        type: "markdownDocument",
        path: `markdown-document://${spec.documentId}`,
        name: "Untitled Document",
        content: spec.content ?? "",
      };
    case "markdownPreview":
      return {
        ...base,
        type: "markdownPreview",
        path: spec.path,
        name: spec.name,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "htmlPreview":
      return {
        ...base,
        type: "htmlPreview",
        path: spec.path,
        name: spec.name,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "csvPreview":
      return {
        ...base,
        type: "csvPreview",
        path: spec.path,
        name: spec.name,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "svgPreview":
      return {
        ...base,
        type: "svgPreview",
        path: spec.path,
        name: spec.name,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "externalEditor":
      return {
        ...base,
        type: "externalEditor",
        path: spec.path,
        name: spec.name,
        terminalConnectionId: spec.terminalConnectionId,
      };
    case "globalSearch":
    case "diagnostics":
    case "references":
    case "continuousAgents":
    case "acpInspector":
    case "agentChanges":
    case "workspaces":
    case "settings":
    case "extensions": {
      const metadata = SINGLETON_TOOL_BUFFER_METADATA[spec.type];
      return {
        ...base,
        type: spec.type,
        path: metadata.path,
        name: metadata.name,
      };
    }
    case "extension":
      return {
        ...base,
        type: "extension",
        path: `extension://${encodeURIComponent(spec.extensionId)}`,
        name: spec.name,
        extensionId: spec.extensionId,
      };
    case "onboarding":
      return {
        ...base,
        type: "onboarding",
        path: `onboarding://${spec.context.mode}/${spec.context.currentVersion}`,
        name: spec.context.mode === "release-notes" ? "What's New" : "Welcome",
        mode: spec.context.mode,
        currentVersion: spec.context.currentVersion,
        previousVersion: spec.context.previousVersion,
      };
  }
};
