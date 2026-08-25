import type { ExtensionViewNode } from "../types/extension-view";
import type { ExtensionPermissions } from "@/extensions/types/extension-manifest";
import { parseExtensionViewNode } from "./extension-view-schema";
import {
  parseGeneratedExtensionPermissions,
  validateGeneratedExtensionPermissionUsage,
} from "./generated/generated-ui-extension-permissions";
import { validateGeneratedExtensionSource } from "./generated/generated-ui-extension-source";

export type UIExtensionContributionType = "sidebar" | "toolbar" | "command";

export interface UIExtensionGenerationResult {
  id: string;
  name: string;
  description: string;
  code: string;
  permissions?: ExtensionPermissions;
  preview?: {
    title?: string;
    summary?: string;
    highlights?: string[];
    primaryAction?: string;
    view?: ExtensionViewNode;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertStaticPreviewNode(node: ExtensionViewNode): void {
  if (
    node.type === "button" ||
    node.type === "form" ||
    node.type === "input" ||
    node.type === "textarea" ||
    node.type === "numberInput" ||
    node.type === "select" ||
    node.type === "toggle" ||
    node.type === "checkbox" ||
    node.type === "choice" ||
    node.type === "tabs"
  ) {
    throw new Error(`Generated extension preview must not include interactive ${node.type} nodes.`);
  }

  if (node.type === "screen") {
    if (node.actions?.length) {
      throw new Error("Generated extension preview must not include actions.");
    }
    node.children.forEach(assertStaticPreviewNode);
    return;
  }
  if (node.type === "listItem" && node.onSelect) {
    throw new Error("Generated extension preview must not include actions.");
  }
  if (node.type === "activity" && node.items.some((item) => item.onSelect)) {
    throw new Error("Generated extension preview must not include actions.");
  }
  if (node.type === "tree") {
    const pending = [...node.items];
    while (pending.length > 0) {
      const item = pending.pop();
      if (!item) continue;
      if (item.onSelect) {
        throw new Error("Generated extension preview must not include actions.");
      }
      if (item.children) pending.push(...item.children);
    }
  }
  if (node.type === "disclosure") {
    if (node.onChange) {
      throw new Error("Generated extension preview must not include actions.");
    }
    node.children.forEach(assertStaticPreviewNode);
    return;
  }
  if (
    node.type === "stack" ||
    node.type === "row" ||
    node.type === "section" ||
    node.type === "card" ||
    node.type === "list"
  ) {
    node.children.forEach(assertStaticPreviewNode);
  }
}

export function parseUIExtensionGenerationResult(value: unknown): UIExtensionGenerationResult {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.code !== "string"
  ) {
    throw new Error("Invalid UI extension generation response.");
  }

  validateGeneratedExtensionSource(value.code);
  const permissions = parseGeneratedExtensionPermissions(value.permissions);
  validateGeneratedExtensionPermissionUsage(value.code, permissions);
  const preview = isRecord(value.preview) ? value.preview : null;
  const highlights = Array.isArray(preview?.highlights)
    ? preview.highlights
        .filter((highlight): highlight is string => typeof highlight === "string")
        .map((highlight) => highlight.trim())
        .filter(Boolean)
        .slice(0, 3)
    : undefined;
  const view = preview?.view == null ? undefined : parseExtensionViewNode(preview.view);
  if (view) assertStaticPreviewNode(view);
  const normalizedPreview = preview
    ? {
        title: optionalString(preview.title),
        summary: optionalString(preview.summary),
        highlights,
        primaryAction: optionalString(preview.primaryAction),
        view,
      }
    : undefined;

  return {
    id: value.id,
    name: value.name,
    description: value.description,
    code: value.code,
    ...(Object.keys(permissions).length > 0 ? { permissions } : {}),
    preview: normalizedPreview,
  };
}
