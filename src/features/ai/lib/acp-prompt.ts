import { getAcpPathBaseName, toAcpFileUri } from "@/features/ai/lib/acp-file-uri";
import { getAcpMimeType } from "@/features/ai/lib/acp-mime-type";
import { getFollowUpActionsInstruction } from "@/features/ai/lib/follow-up-actions";
import type { AcpPromptContentBlock } from "@/features/ai/types/acp.types";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import { buildContextPrompt } from "@/features/ai/utils/ai-context-builder";

interface AcpPromptOptions {
  /** The agent takes embedded `resource` blocks (`promptCapabilities.embeddedContext`). */
  embeddedContext: boolean;
}

/** A `file://` URI for lines `startLine`..`endLine` (1-based) of `path`. */
function selectionUri(path: string, startLine: number, endLine: number): string {
  return `${toAcpFileUri(path)}#L${startLine}:${endLine}`;
}

function withMimeType<T extends object>(block: T, path: string): T & { mimeType?: string } {
  const mimeType = getAcpMimeType(path);
  return mimeType ? { ...block, mimeType } : block;
}

/**
 * The ACP prompt for a user message and the chat's context. The context is described in the
 * leading text block; files and editor selections go as their own blocks: embedded resources
 * when the agent takes them, links to the files otherwise. Images come last.
 */
export function buildAcpPrompt(
  userMessage: string,
  context: ContextInfo,
  { embeddedContext }: AcpPromptOptions,
): AcpPromptContentBlock[] {
  const images: AcpPromptContentBlock[] = (context.images ?? []).map((image) => ({
    type: "image",
    data: image.data,
    mimeType: image.mediaType,
  }));
  // ACP slash commands must remain the first token in the prompt.
  // If we prepend context, agents interpret them as plain text.
  if (userMessage.trimStart().startsWith("/")) {
    return [{ type: "text", text: userMessage }, ...images];
  }

  const contextPrompt = [
    buildContextPrompt(context, { attachedSelections: embeddedContext }),
    getFollowUpActionsInstruction(),
  ]
    .filter(Boolean)
    .join("\n\n");
  const blocks: AcpPromptContentBlock[] = [
    { type: "text", text: contextPrompt ? `${contextPrompt}\n\n${userMessage}` : userMessage },
  ];

  for (const file of context.mentionedFiles || []) {
    if (embeddedContext) {
      blocks.push({
        type: "resource",
        resource: {
          uri: toAcpFileUri(file.path),
          text: file.content,
          mimeType: getAcpMimeType(file.path) ?? "text/plain",
        },
      });
    } else {
      blocks.push(
        withMimeType(
          {
            type: "resource_link",
            uri: toAcpFileUri(file.path),
            name: getAcpPathBaseName(file.path),
          },
          file.path,
        ),
      );
    }
  }

  if (embeddedContext) {
    for (const selection of context.editorSelections ?? []) {
      blocks.push({
        type: "resource",
        resource: {
          uri: selectionUri(selection.filePath, selection.startLine, selection.endLine),
          text: selection.selectedText,
          mimeType: getAcpMimeType(selection.filePath) ?? "text/plain",
        },
      });
    }
  }

  const resourceLinks = new Set<string>();
  for (const filePath of context.selectedProjectFiles || []) {
    if (context.mentionedFiles?.some((file) => file.path === filePath)) {
      continue;
    }
    if (resourceLinks.has(filePath)) {
      continue;
    }
    resourceLinks.add(filePath);
    blocks.push(
      withMimeType(
        { type: "resource_link", uri: toAcpFileUri(filePath), name: getAcpPathBaseName(filePath) },
        filePath,
      ),
    );
  }

  return [...blocks, ...images];
}
