import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { EditorSelectionContext } from "../types/ai-context.types";
import type { PastedImage } from "../types/chat-composer.types";
import { getBaseName } from "@/utils/path-helpers";

export type ComposerAttachmentKind =
  | "files"
  | "diffs"
  | "images"
  | "selections"
  | "terminals"
  | "databases"
  | "github"
  | "other";

export interface ComposerAttachmentSource {
  type: "buffer" | "file" | "selection" | "image";
  id: string;
}

export interface ComposerAttachmentEntry {
  key: string;
  name: string;
  path: string;
  kind: ComposerAttachmentKind;
  bufferType?: PaneContent["type"];
  preview?: string;
  sources: ComposerAttachmentSource[];
}

const groupNames: Record<ComposerAttachmentKind, [string, string]> = {
  files: ["file", "files"],
  diffs: ["diff", "diffs"],
  images: ["image", "images"],
  selections: ["selection", "selections"],
  terminals: ["terminal", "terminals"],
  databases: ["database", "databases"],
  github: ["GitHub item", "GitHub items"],
  other: ["resource", "resources"],
};

function getFileKind(path: string): ComposerAttachmentKind {
  return /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(path) ? "images" : "files";
}

function getBufferKind(buffer: PaneContent): ComposerAttachmentKind {
  switch (buffer.type) {
    case "diff":
      return "diffs";
    case "image":
      return "images";
    case "terminal":
      return "terminals";
    case "database":
      return "databases";
    case "pullRequest":
    case "githubIssue":
    case "githubAction":
      return "github";
    case "editor":
    case "pdf":
    case "binary":
    case "markdownDocument":
    case "markdownPreview":
    case "htmlPreview":
    case "csvPreview":
    case "svgPreview":
    case "externalEditor":
      return getFileKind(buffer.path);
    default:
      return "other";
  }
}

export function getComposerAttachmentGroups({
  buffers,
  selectedBufferIds,
  selectedFilesPaths,
  selectedEditorContexts,
  pastedImages,
}: {
  buffers: PaneContent[];
  selectedBufferIds: ReadonlySet<string>;
  selectedFilesPaths: ReadonlySet<string>;
  selectedEditorContexts: EditorSelectionContext[];
  pastedImages: PastedImage[];
}) {
  const entries = new Map<string, ComposerAttachmentEntry>();
  const addEntry = (entry: ComposerAttachmentEntry) => {
    const current = entries.get(entry.key);
    if (current) current.sources.push(...entry.sources);
    else entries.set(entry.key, entry);
  };

  for (const buffer of buffers) {
    if (!selectedBufferIds.has(buffer.id) || buffer.type === "agent" || buffer.type === "newTab")
      continue;
    const kind = getBufferKind(buffer);
    addEntry({
      key: kind === "files" || kind === "images" ? `path:${buffer.path}` : `buffer:${buffer.id}`,
      name: buffer.name,
      path: buffer.path,
      kind,
      bufferType: buffer.type,
      sources: [{ type: "buffer", id: buffer.id }],
    });
  }
  for (const path of selectedFilesPaths) {
    addEntry({
      key: `path:${path}`,
      name: getBaseName(path),
      path,
      kind: getFileKind(path),
      sources: [{ type: "file", id: path }],
    });
  }
  for (const context of selectedEditorContexts) {
    const lines =
      context.startLine === context.endLine
        ? `${context.startLine}`
        : `${context.startLine}–${context.endLine}`;
    addEntry({
      key: `selection:${context.id}`,
      name: `${context.fileName}:${lines}`,
      path: context.filePath,
      kind: "selections",
      sources: [{ type: "selection", id: context.id }],
    });
  }
  for (const image of pastedImages) {
    addEntry({
      key: `image:${image.id}`,
      name: image.name,
      path: "Pasted image",
      kind: "images",
      preview: image.dataUrl,
      sources: [{ type: "image", id: image.id }],
    });
  }

  return (Object.keys(groupNames) as ComposerAttachmentKind[]).flatMap((kind) => {
    const items = Array.from(entries.values()).filter((entry) => entry.kind === kind);
    if (items.length === 0) return [];
    const noun = groupNames[kind][items.length === 1 ? 0 : 1];
    return [{ kind, items, noun, label: `${items.length} ${noun}` }];
  });
}
