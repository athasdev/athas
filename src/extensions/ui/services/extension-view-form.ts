import type {
  ExtensionViewFormValue,
  ExtensionViewFormValues,
  ExtensionViewNode,
} from "../types/extension-view";

export const EXTENSION_VIEW_FORM_LIMITS = {
  maxFields: 50,
  maxNameLength: 64,
  maxValueCharacters: 20_000,
  maxPayloadCharacters: 100_000,
} as const;

export interface ExtensionViewFormFieldState {
  name: string;
  value: ExtensionViewFormValue;
  required: boolean;
}

function visitNodes(nodes: ExtensionViewNode[], fields: ExtensionViewFormFieldState[]): void {
  for (const node of nodes) {
    if (
      node.type === "input" ||
      node.type === "textarea" ||
      node.type === "numberInput" ||
      node.type === "select" ||
      node.type === "toggle" ||
      node.type === "checkbox" ||
      node.type === "choice"
    ) {
      if (!node.name) continue;
      let value: ExtensionViewFormValue;
      if (node.type === "input" || node.type === "textarea" || node.type === "select") {
        value = node.value ?? "";
      } else if (node.type === "numberInput") {
        value = node.value;
      } else if (node.type === "choice") {
        value = Array.isArray(node.value) ? [...node.value] : node.value;
      } else {
        value = node.checked;
      }
      fields.push({ name: node.name, value, required: node.required === true });
      continue;
    }

    if (
      node.type === "screen" ||
      node.type === "stack" ||
      node.type === "row" ||
      node.type === "section" ||
      node.type === "card" ||
      node.type === "form" ||
      node.type === "disclosure" ||
      node.type === "list"
    ) {
      visitNodes(node.children, fields);
      continue;
    }

    if (node.type === "tabs") {
      for (const tab of node.tabs) visitNodes(tab.children, fields);
    }
  }
}

export function collectExtensionViewFormFields(
  nodes: ExtensionViewNode[],
): ExtensionViewFormFieldState[] {
  const fields: ExtensionViewFormFieldState[] = [];
  visitNodes(nodes, fields);
  return fields;
}

export function createExtensionViewFormValues(
  fields: ExtensionViewFormFieldState[],
): ExtensionViewFormValues {
  return Object.fromEntries(fields.map((field) => [field.name, field.value]));
}

export function isExtensionViewFormValueMissing(
  value: ExtensionViewFormValue | undefined,
): boolean {
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "boolean") return !value;
  return !value || value.length === 0;
}

export function getMissingExtensionViewFormFields(
  fields: ExtensionViewFormFieldState[],
  values: ExtensionViewFormValues,
): string[] {
  return fields
    .filter((field) => field.required && isExtensionViewFormValueMissing(values[field.name]))
    .map((field) => field.name);
}

export function extensionViewFormPayloadFits(values: ExtensionViewFormValues): boolean {
  return JSON.stringify(values).length <= EXTENSION_VIEW_FORM_LIMITS.maxPayloadCharacters;
}
