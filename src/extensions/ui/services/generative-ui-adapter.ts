import type {
  GenerativeUIAction,
  GenerativeUIComponent,
  GenerativeUIView,
} from "../types/generative-ui";
import type { ExtensionViewNode } from "../types/extension-view";
import { EXTENSION_VIEW_LIMITS, parseExtensionViewNode } from "./extension-view-schema";

export const OPEN_EXTERNAL_VIEW_COMMAND = "athas.openExternal";

interface AdapterContext {
  nodes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLegacyComponent(value: GenerativeUIView | unknown): value is GenerativeUIComponent {
  return isRecord(value) && isRecord(value.props);
}

function legacyActionNode(action: GenerativeUIAction): ExtensionViewNode | null {
  const command =
    typeof action.command === "string" && action.command.trim()
      ? action.command
      : typeof action.url === "string" && action.url.trim()
        ? OPEN_EXTERNAL_VIEW_COMMAND
        : null;
  if (!command || typeof action.label !== "string" || !action.label.trim()) return null;

  return {
    type: "button",
    label: action.label,
    action: {
      command,
      ...(command === OPEN_EXTERNAL_VIEW_COMMAND ? { args: [action.url] } : {}),
    },
    tone: action.style === "primary" ? "accent" : action.style === "danger" ? "danger" : "default",
  };
}

function legacyActions(value: unknown): ExtensionViewNode[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, EXTENSION_VIEW_LIMITS.maxActions)
    .filter(isRecord)
    .map((action) => legacyActionNode(action as unknown as GenerativeUIAction))
    .filter((action): action is ExtensionViewNode => action !== null);
}

function legacyChildren(
  value: unknown,
  depth: number,
  context: AdapterContext,
): ExtensionViewNode[] {
  if (!Array.isArray(value)) return [];
  if (value.length > EXTENSION_VIEW_LIMITS.maxChildren) {
    throw new Error(
      `Legacy generative UI must contain at most ${EXTENSION_VIEW_LIMITS.maxChildren} children per node.`,
    );
  }
  return value.map((child) => convertLegacyComponent(child, depth + 1, context));
}

function textValue(value: unknown): string | number {
  return typeof value === "number" ? value : String(value ?? "");
}

function legacyTable(props: Record<string, unknown>): ExtensionViewNode {
  const rows = Array.isArray(props.rows)
    ? props.rows.map((row) => (Array.isArray(row) ? row.map(textValue) : [textValue(row)]))
    : [];
  const headers = Array.isArray(props.headers) ? props.headers.map((header) => String(header)) : [];
  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length), 0);
  const columns = Array.from(
    { length: columnCount },
    (_, index) => headers[index] ?? `Column ${index + 1}`,
  );

  if (columns.length === 0) {
    return { type: "empty", message: "No table data" };
  }

  return { type: "table", columns, rows };
}

function convertLegacyComponent(
  value: unknown,
  depth: number,
  context: AdapterContext,
): ExtensionViewNode {
  if (depth > EXTENSION_VIEW_LIMITS.maxDepth) {
    throw new Error(
      `Legacy generative UI exceeds the maximum depth of ${EXTENSION_VIEW_LIMITS.maxDepth}.`,
    );
  }
  context.nodes += 1;
  if (context.nodes > EXTENSION_VIEW_LIMITS.maxNodes) {
    throw new Error(
      `Legacy generative UI exceeds the maximum node count of ${EXTENSION_VIEW_LIMITS.maxNodes}.`,
    );
  }
  if (!isRecord(value) || !isRecord(value.props) || typeof value.type !== "string") {
    throw new Error("Legacy generative UI contains an invalid component.");
  }

  const children = legacyChildren(value.children, depth, context);
  const actions = legacyActions(value.actions);
  const content = [...children, ...actions];

  switch (value.type) {
    case "card":
      return {
        type: "card",
        title: typeof value.props.title === "string" ? value.props.title : undefined,
        description:
          typeof value.props.description === "string" ? value.props.description : undefined,
        children: content,
      };
    case "list": {
      const items = Array.isArray(value.props.items)
        ? value.props.items.map((item) => ({
            type: "listItem" as const,
            title: String(item),
          }))
        : [];
      return { type: "list", children: [...items, ...content] };
    }
    case "table":
      return content.length > 0
        ? { type: "stack", children: [legacyTable(value.props), ...content] }
        : legacyTable(value.props);
    case "form":
    case "custom":
      return { type: "stack", children: content };
    default:
      throw new Error(`Unsupported legacy generative UI component: ${value.type}`);
  }
}

export function normalizeGenerativeUIView(value: GenerativeUIView | unknown): ExtensionViewNode {
  if (!isLegacyComponent(value)) return parseExtensionViewNode(value);
  return parseExtensionViewNode(convertLegacyComponent(value, 0, { nodes: 0 }));
}
