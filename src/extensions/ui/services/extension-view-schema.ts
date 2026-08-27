import type {
  ExtensionViewAction,
  ExtensionViewBadge,
  ExtensionViewNode,
  ExtensionViewTreeItem,
  ExtensionViewValue,
} from "../types/extension-view";
import { collectExtensionViewFormFields, EXTENSION_VIEW_FORM_LIMITS } from "./extension-view-form";

export const EXTENSION_VIEW_LIMITS = {
  maxDepth: 20,
  maxNodes: 500,
  maxChildren: 100,
  maxActions: 20,
  maxBadges: 10,
  maxOptions: 100,
  maxMetadataItems: 100,
  maxActivityItems: 100,
  maxTreeItems: 250,
  maxTreeDepth: 12,
  maxActionArgs: 20,
  maxLabelLength: 500,
  maxTextLength: 20_000,
  maxCodeLength: 100_000,
  maxTableColumns: 20,
  maxTableRows: 250,
  maxChartPoints: 120,
  maxChartItems: 50,
  maxDiffLines: 500,
  maxPayloadCharacters: 500_000,
  maxPayloadValues: 20_000,
} as const;

const VIEW_TONES = ["default", "muted", "accent", "success", "warning", "error"] as const;
const BUTTON_TONES = ["default", "accent", "danger", "ghost"] as const;
const CALLOUT_TONES = ["default", "info", "success", "warning", "error"] as const;
const CARD_VARIANTS = ["default", "muted", "outline"] as const;
const INPUT_TYPES = ["text", "password", "url"] as const;
const ACTIVITY_STATES = ["default", "running", "success", "warning", "error"] as const;
const DIFF_LINE_TYPES = ["context", "added", "removed", "header"] as const;

interface ParseContext {
  nodes: number;
  formDepth: number;
}

export class ExtensionViewValidationError extends Error {
  constructor(path: string, message: string) {
    super(`Invalid extension view at ${path}: ${message}`);
    this.name = "ExtensionViewValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new ExtensionViewValidationError(path, message);
}

function assertPayloadBudget(value: unknown): void {
  const pending = [value];
  const seen = new WeakSet<object>();
  let characters = 0;
  let values = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    values += 1;
    if (values > EXTENSION_VIEW_LIMITS.maxPayloadValues) {
      fail(
        "$",
        `exceeds the maximum payload size of ${EXTENSION_VIEW_LIMITS.maxPayloadValues} values`,
      );
    }
    if (typeof current === "string") {
      characters += current.length;
      if (characters > EXTENSION_VIEW_LIMITS.maxPayloadCharacters) {
        fail(
          "$",
          `exceeds the maximum text payload of ${EXTENSION_VIEW_LIMITS.maxPayloadCharacters} characters`,
        );
      }
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) pending.push(...current);
    else pending.push(...Object.values(current));
  }
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, path: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string") fail(path, "expected a string");
  if (!allowEmpty && value.trim().length === 0) fail(path, "must not be empty");
  if (value.length > maxLength) fail(path, `must be at most ${maxLength} characters`);
  return value;
}

function readOptionalString(value: unknown, path: string, maxLength: number): string | undefined {
  return value == null ? undefined : readString(value, path, maxLength, true);
}

function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "expected a finite number");
  }
  return value;
}

function readOptionalFiniteNumber(value: unknown, path: string): number | undefined {
  return value == null ? undefined : readFiniteNumber(value, path);
}

function readOptionalLineNumber(value: unknown, path: string): number | undefined {
  const number = readOptionalFiniteNumber(value, path);
  if (number != null && (!Number.isInteger(number) || number < 1)) {
    fail(path, "must be a positive integer");
  }
  return number;
}

function readOptionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function readOptionalEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function readEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const result = readOptionalEnum(value, path, allowed);
  if (result == null) fail(path, `expected one of ${allowed.join(", ")}`);
  return result;
}

function readFormField(
  node: Record<string, unknown>,
  path: string,
  context: ParseContext,
): { name?: string; required?: boolean } {
  const name =
    node.name == null
      ? undefined
      : readString(node.name, `${path}.name`, EXTENSION_VIEW_FORM_LIMITS.maxNameLength);
  const required = readOptionalBoolean(node.required, `${path}.required`);

  if ((name != null || required != null) && context.formDepth === 0) {
    fail(path, "form field metadata is only valid inside a form");
  }
  if (required && !name) fail(`${path}.required`, "requires a form field name");
  if (required && node.disabled === true) {
    fail(`${path}.required`, "must not be used on a disabled field");
  }
  if (name && !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) {
    fail(`${path}.name`, "must start with a letter and contain only letters, numbers, ., _, or -");
  }
  if (name && ["constructor", "prototype", "__proto__"].includes(name)) {
    fail(`${path}.name`, "uses a reserved field name");
  }

  return { name, required };
}

function readAction(value: unknown, path: string): ExtensionViewAction {
  const action = readRecord(value, path);
  const args = action.args;
  if (args != null && !Array.isArray(args)) fail(`${path}.args`, "expected an array");
  if (Array.isArray(args) && args.length > EXTENSION_VIEW_LIMITS.maxActionArgs) {
    fail(`${path}.args`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxActionArgs} values`);
  }
  return {
    command: readString(action.command, `${path}.command`, EXTENSION_VIEW_LIMITS.maxLabelLength),
    ...(Array.isArray(args) ? { args } : {}),
  };
}

function readBadge(value: unknown, path: string): ExtensionViewBadge {
  const badge = readRecord(value, path);
  return {
    label: readString(badge.label, `${path}.label`, EXTENSION_VIEW_LIMITS.maxLabelLength),
    tone: readOptionalEnum(badge.tone, `${path}.tone`, VIEW_TONES),
  };
}

interface TreeParseContext {
  items: number;
  ids: Set<string>;
}

function readTreeItems(
  value: unknown,
  path: string,
  depth: number,
  context: TreeParseContext,
): ExtensionViewTreeItem[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  if (depth > EXTENSION_VIEW_LIMITS.maxTreeDepth) {
    fail(path, `exceeds the maximum tree depth of ${EXTENSION_VIEW_LIMITS.maxTreeDepth}`);
  }
  if (value.length > EXTENSION_VIEW_LIMITS.maxChildren) {
    fail(path, `must contain at most ${EXTENSION_VIEW_LIMITS.maxChildren} items`);
  }

  return value.map((value, index) => {
    const itemPath = `${path}[${index}]`;
    const item = readRecord(value, itemPath);
    context.items += 1;
    if (context.items > EXTENSION_VIEW_LIMITS.maxTreeItems) {
      fail(
        itemPath,
        `exceeds the maximum tree item count of ${EXTENSION_VIEW_LIMITS.maxTreeItems}`,
      );
    }

    const id = readString(item.id, `${itemPath}.id`, EXTENSION_VIEW_LIMITS.maxLabelLength);
    if (context.ids.has(id)) fail(`${itemPath}.id`, `contains duplicate tree item id "${id}"`);
    context.ids.add(id);

    const badges = item.badges;
    if (badges != null && !Array.isArray(badges)) {
      fail(`${itemPath}.badges`, "expected an array");
    }
    if (Array.isArray(badges) && badges.length > EXTENSION_VIEW_LIMITS.maxBadges) {
      fail(`${itemPath}.badges`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxBadges} badges`);
    }

    const children =
      item.children == null
        ? undefined
        : readTreeItems(item.children, `${itemPath}.children`, depth + 1, context);
    return {
      id,
      title: readString(item.title, `${itemPath}.title`, EXTENSION_VIEW_LIMITS.maxLabelLength),
      description: readOptionalString(
        item.description,
        `${itemPath}.description`,
        EXTENSION_VIEW_LIMITS.maxTextLength,
      ),
      meta: readOptionalString(item.meta, `${itemPath}.meta`, EXTENSION_VIEW_LIMITS.maxLabelLength),
      icon: readOptionalString(item.icon, `${itemPath}.icon`, EXTENSION_VIEW_LIMITS.maxLabelLength),
      badges: Array.isArray(badges)
        ? badges.map((badge, badgeIndex) => readBadge(badge, `${itemPath}.badges[${badgeIndex}]`))
        : undefined,
      expanded: readOptionalBoolean(item.expanded, `${itemPath}.expanded`),
      onSelect:
        item.onSelect == null ? undefined : readAction(item.onSelect, `${itemPath}.onSelect`),
      children,
    };
  });
}

function readChildren(
  value: unknown,
  path: string,
  depth: number,
  context: ParseContext,
): ExtensionViewNode[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  if (value.length > EXTENSION_VIEW_LIMITS.maxChildren) {
    fail(path, `must contain at most ${EXTENSION_VIEW_LIMITS.maxChildren} nodes`);
  }
  return value.map((child, index) => readNode(child, `${path}[${index}]`, depth + 1, context));
}

function readViewValue(value: unknown, path: string): ExtensionViewValue {
  if (typeof value === "number") return readFiniteNumber(value, path);
  return readString(value, path, EXTENSION_VIEW_LIMITS.maxTextLength, true);
}

function readNode(
  value: unknown,
  path: string,
  depth: number,
  context: ParseContext,
): ExtensionViewNode {
  if (depth > EXTENSION_VIEW_LIMITS.maxDepth) {
    fail(path, `exceeds the maximum depth of ${EXTENSION_VIEW_LIMITS.maxDepth}`);
  }
  context.nodes += 1;
  if (context.nodes > EXTENSION_VIEW_LIMITS.maxNodes) {
    fail(path, `exceeds the maximum node count of ${EXTENSION_VIEW_LIMITS.maxNodes}`);
  }

  const node = readRecord(value, path);
  const type = readString(node.type, `${path}.type`, 40);

  switch (type) {
    case "screen": {
      const actions = node.actions;
      if (actions != null && !Array.isArray(actions)) {
        fail(`${path}.actions`, "expected an array");
      }
      if (Array.isArray(actions) && actions.length > EXTENSION_VIEW_LIMITS.maxActions) {
        fail(`${path}.actions`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxActions} actions`);
      }
      return {
        type,
        title: readOptionalString(
          node.title,
          `${path}.title`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        actions: Array.isArray(actions)
          ? actions.map((value, index) => {
              const item = readRecord(value, `${path}.actions[${index}]`);
              return {
                label: readString(
                  item.label,
                  `${path}.actions[${index}].label`,
                  EXTENSION_VIEW_LIMITS.maxLabelLength,
                ),
                icon: readOptionalString(
                  item.icon,
                  `${path}.actions[${index}].icon`,
                  EXTENSION_VIEW_LIMITS.maxLabelLength,
                ),
                action: readAction(item.action, `${path}.actions[${index}].action`),
              };
            })
          : undefined,
        children: readChildren(node.children, `${path}.children`, depth, context),
      };
    }
    case "stack":
    case "row":
    case "list":
      return {
        type,
        children: readChildren(node.children, `${path}.children`, depth, context),
      };
    case "section":
      return {
        type,
        title: readString(node.title, `${path}.title`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        children: readChildren(node.children, `${path}.children`, depth, context),
      };
    case "card":
      return {
        type,
        title: readOptionalString(
          node.title,
          `${path}.title`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        description: readOptionalString(
          node.description,
          `${path}.description`,
          EXTENSION_VIEW_LIMITS.maxTextLength,
        ),
        variant: readOptionalEnum(node.variant, `${path}.variant`, CARD_VARIANTS),
        children: readChildren(node.children, `${path}.children`, depth, context),
      };
    case "form": {
      if (context.formDepth > 0) fail(path, "forms must not be nested");
      context.formDepth += 1;
      let children: ExtensionViewNode[];
      try {
        children = readChildren(node.children, `${path}.children`, depth, context);
      } finally {
        context.formDepth -= 1;
      }
      const fields = collectExtensionViewFormFields(children);
      if (fields.length === 0) fail(`${path}.children`, "must contain at least one named field");
      if (fields.length > EXTENSION_VIEW_FORM_LIMITS.maxFields) {
        fail(
          `${path}.children`,
          `must contain at most ${EXTENSION_VIEW_FORM_LIMITS.maxFields} named fields`,
        );
      }
      const duplicateName = fields.find(
        (field, index) => fields.findIndex((candidate) => candidate.name === field.name) !== index,
      )?.name;
      if (duplicateName)
        fail(`${path}.children`, `contains duplicate field name "${duplicateName}"`);
      return {
        type,
        submitLabel: readString(
          node.submitLabel,
          `${path}.submitLabel`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        pendingLabel: readOptionalString(
          node.pendingLabel,
          `${path}.pendingLabel`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        onSubmit: readAction(node.onSubmit, `${path}.onSubmit`),
        disabled: readOptionalBoolean(node.disabled, `${path}.disabled`),
        children,
      };
    }
    case "text":
      return {
        type,
        value: readString(node.value, `${path}.value`, EXTENSION_VIEW_LIMITS.maxTextLength, true),
        tone: readOptionalEnum(node.tone, `${path}.tone`, VIEW_TONES),
      };
    case "badge":
      return {
        type,
        label: readString(node.label, `${path}.label`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        tone: readOptionalEnum(node.tone, `${path}.tone`, VIEW_TONES),
      };
    case "metric":
      return {
        type,
        label: readString(node.label, `${path}.label`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        value: readViewValue(node.value, `${path}.value`),
        detail: readOptionalString(
          node.detail,
          `${path}.detail`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        tone: readOptionalEnum(node.tone, `${path}.tone`, VIEW_TONES),
      };
    case "progress":
      return {
        type,
        value: Math.min(100, Math.max(0, readFiniteNumber(node.value, `${path}.value`))),
        label: readOptionalString(
          node.label,
          `${path}.label`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        detail: readOptionalString(
          node.detail,
          `${path}.detail`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
      };
    case "sparkline": {
      if (!Array.isArray(node.values)) fail(`${path}.values`, "expected an array");
      if (node.values.length < 2) fail(`${path}.values`, "must contain at least two points");
      if (node.values.length > EXTENSION_VIEW_LIMITS.maxChartPoints) {
        fail(
          `${path}.values`,
          `must contain at most ${EXTENSION_VIEW_LIMITS.maxChartPoints} points`,
        );
      }
      return {
        type,
        label: readString(node.label, `${path}.label`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        values: node.values.map((value, index) =>
          readFiniteNumber(value, `${path}.values[${index}]`),
        ),
        detail: readOptionalString(
          node.detail,
          `${path}.detail`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        tone: readOptionalEnum(node.tone, `${path}.tone`, VIEW_TONES),
      };
    }
    case "barChart": {
      if (!Array.isArray(node.items)) fail(`${path}.items`, "expected an array");
      if (node.items.length === 0) fail(`${path}.items`, "must contain at least one item");
      if (node.items.length > EXTENSION_VIEW_LIMITS.maxChartItems) {
        fail(`${path}.items`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxChartItems} items`);
      }
      return {
        type,
        label: readOptionalString(
          node.label,
          `${path}.label`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        items: node.items.map((value, index) => {
          const item = readRecord(value, `${path}.items[${index}]`);
          const itemValue = readFiniteNumber(item.value, `${path}.items[${index}].value`);
          if (itemValue < 0) fail(`${path}.items[${index}].value`, "must not be negative");
          return {
            label: readString(
              item.label,
              `${path}.items[${index}].label`,
              EXTENSION_VIEW_LIMITS.maxLabelLength,
            ),
            value: itemValue,
            detail: readOptionalString(
              item.detail,
              `${path}.items[${index}].detail`,
              EXTENSION_VIEW_LIMITS.maxLabelLength,
            ),
            tone: readOptionalEnum(item.tone, `${path}.items[${index}].tone`, VIEW_TONES),
          };
        }),
      };
    }
    case "callout":
      return {
        type,
        title: readString(node.title, `${path}.title`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        description: readOptionalString(
          node.description,
          `${path}.description`,
          EXTENSION_VIEW_LIMITS.maxTextLength,
        ),
        tone: readOptionalEnum(node.tone, `${path}.tone`, CALLOUT_TONES),
      };
    case "table": {
      if (!Array.isArray(node.columns)) fail(`${path}.columns`, "expected an array");
      if (node.columns.length === 0) fail(`${path}.columns`, "must contain at least one column");
      if (node.columns.length > EXTENSION_VIEW_LIMITS.maxTableColumns) {
        fail(
          `${path}.columns`,
          `must contain at most ${EXTENSION_VIEW_LIMITS.maxTableColumns} columns`,
        );
      }
      if (!Array.isArray(node.rows)) fail(`${path}.rows`, "expected an array");
      if (node.rows.length > EXTENSION_VIEW_LIMITS.maxTableRows) {
        fail(`${path}.rows`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxTableRows} rows`);
      }
      const columns = node.columns.map((column, index) =>
        readString(column, `${path}.columns[${index}]`, EXTENSION_VIEW_LIMITS.maxLabelLength),
      );
      const rows = node.rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) fail(`${path}.rows[${rowIndex}]`, "expected an array");
        if (row.length > columns.length) {
          fail(`${path}.rows[${rowIndex}]`, "contains more cells than the table has columns");
        }
        return row.map((cell, columnIndex) =>
          readViewValue(cell, `${path}.rows[${rowIndex}][${columnIndex}]`),
        );
      });
      return {
        type,
        columns,
        rows,
        caption: readOptionalString(
          node.caption,
          `${path}.caption`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
      };
    }
    case "code":
      return {
        type,
        value: readString(node.value, `${path}.value`, EXTENSION_VIEW_LIMITS.maxCodeLength, true),
        language: readOptionalString(node.language, `${path}.language`, 100),
        wrap: readOptionalBoolean(node.wrap, `${path}.wrap`),
      };
    case "diff": {
      if (!Array.isArray(node.lines)) fail(`${path}.lines`, "expected an array");
      if (node.lines.length === 0) fail(`${path}.lines`, "must contain at least one line");
      if (node.lines.length > EXTENSION_VIEW_LIMITS.maxDiffLines) {
        fail(`${path}.lines`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxDiffLines} lines`);
      }
      return {
        type,
        filePath: readString(
          node.filePath,
          `${path}.filePath`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        oldPath: readOptionalString(
          node.oldPath,
          `${path}.oldPath`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        language: readOptionalString(node.language, `${path}.language`, 100),
        lines: node.lines.map((value, index) => {
          const line = readRecord(value, `${path}.lines[${index}]`);
          return {
            type: readEnum(line.type, `${path}.lines[${index}].type`, DIFF_LINE_TYPES),
            content: readString(
              line.content,
              `${path}.lines[${index}].content`,
              EXTENSION_VIEW_LIMITS.maxTextLength,
              true,
            ),
            oldLine: readOptionalLineNumber(line.oldLine, `${path}.lines[${index}].oldLine`),
            newLine: readOptionalLineNumber(line.newLine, `${path}.lines[${index}].newLine`),
          };
        }),
        truncated: readOptionalBoolean(node.truncated, `${path}.truncated`),
      };
    }
    case "activity": {
      if (!Array.isArray(node.items)) fail(`${path}.items`, "expected an array");
      if (node.items.length === 0) fail(`${path}.items`, "must contain at least one item");
      if (node.items.length > EXTENSION_VIEW_LIMITS.maxActivityItems) {
        fail(
          `${path}.items`,
          `must contain at most ${EXTENSION_VIEW_LIMITS.maxActivityItems} items`,
        );
      }
      return {
        type,
        items: node.items.map((value, index) => {
          const item = readRecord(value, `${path}.items[${index}]`);
          return {
            title: readString(
              item.title,
              `${path}.items[${index}].title`,
              EXTENSION_VIEW_LIMITS.maxLabelLength,
            ),
            description: readOptionalString(
              item.description,
              `${path}.items[${index}].description`,
              EXTENSION_VIEW_LIMITS.maxTextLength,
            ),
            meta: readOptionalString(
              item.meta,
              `${path}.items[${index}].meta`,
              EXTENSION_VIEW_LIMITS.maxLabelLength,
            ),
            state: readOptionalEnum(item.state, `${path}.items[${index}].state`, ACTIVITY_STATES),
            icon: readOptionalString(
              item.icon,
              `${path}.items[${index}].icon`,
              EXTENSION_VIEW_LIMITS.maxLabelLength,
            ),
            onSelect:
              item.onSelect == null
                ? undefined
                : readAction(item.onSelect, `${path}.items[${index}].onSelect`),
          };
        }),
      };
    }
    case "button":
      return {
        type,
        label: readString(node.label, `${path}.label`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        pendingLabel: readOptionalString(
          node.pendingLabel,
          `${path}.pendingLabel`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        action: readAction(node.action, `${path}.action`),
        tone: readOptionalEnum(node.tone, `${path}.tone`, BUTTON_TONES),
        disabled: readOptionalBoolean(node.disabled, `${path}.disabled`),
      };
    case "input": {
      const field = readFormField(node, path, context);
      if (node.onChange == null && node.onSubmit == null && !field.name && node.disabled !== true) {
        fail(path, "requires onChange, onSubmit, or a form field name");
      }
      return {
        type,
        ...field,
        label: readOptionalString(
          node.label,
          `${path}.label`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        value: readOptionalString(node.value, `${path}.value`, EXTENSION_VIEW_LIMITS.maxTextLength),
        placeholder: readOptionalString(
          node.placeholder,
          `${path}.placeholder`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        inputType: readOptionalEnum(node.inputType, `${path}.inputType`, INPUT_TYPES),
        onChange: node.onChange == null ? undefined : readAction(node.onChange, `${path}.onChange`),
        onSubmit: node.onSubmit == null ? undefined : readAction(node.onSubmit, `${path}.onSubmit`),
        disabled: readOptionalBoolean(node.disabled, `${path}.disabled`),
      };
    }
    case "textarea": {
      const field = readFormField(node, path, context);
      if (node.onChange == null && node.onSubmit == null && !field.name && node.disabled !== true) {
        fail(path, "requires onChange, onSubmit, or a form field name");
      }
      const rows = node.rows == null ? undefined : readFiniteNumber(node.rows, `${path}.rows`);
      if (rows != null && (!Number.isInteger(rows) || rows < 2 || rows > 12)) {
        fail(`${path}.rows`, "must be an integer between 2 and 12");
      }
      return {
        type,
        ...field,
        label: readOptionalString(
          node.label,
          `${path}.label`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        value: readOptionalString(node.value, `${path}.value`, EXTENSION_VIEW_LIMITS.maxTextLength),
        placeholder: readOptionalString(
          node.placeholder,
          `${path}.placeholder`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        rows,
        onChange: node.onChange == null ? undefined : readAction(node.onChange, `${path}.onChange`),
        onSubmit: node.onSubmit == null ? undefined : readAction(node.onSubmit, `${path}.onSubmit`),
        disabled: readOptionalBoolean(node.disabled, `${path}.disabled`),
      };
    }
    case "numberInput": {
      const field = readFormField(node, path, context);
      if (node.onChange == null && node.onSubmit == null && !field.name && node.disabled !== true) {
        fail(path, "requires onChange, onSubmit, or a form field name");
      }
      const value = readFiniteNumber(node.value, `${path}.value`);
      const min = readOptionalFiniteNumber(node.min, `${path}.min`);
      const max = readOptionalFiniteNumber(node.max, `${path}.max`);
      const step = readOptionalFiniteNumber(node.step, `${path}.step`);
      if (step != null && step <= 0) fail(`${path}.step`, "must be greater than zero");
      if (min != null && max != null && min > max) {
        fail(path, "minimum must not be greater than maximum");
      }
      if (min != null && value < min) {
        fail(`${path}.value`, "must not be less than the minimum");
      }
      if (max != null && value > max) {
        fail(`${path}.value`, "must not be greater than the maximum");
      }
      return {
        type,
        ...field,
        label: readOptionalString(
          node.label,
          `${path}.label`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        value,
        placeholder: readOptionalString(
          node.placeholder,
          `${path}.placeholder`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        min,
        max,
        step,
        onChange: node.onChange == null ? undefined : readAction(node.onChange, `${path}.onChange`),
        onSubmit: node.onSubmit == null ? undefined : readAction(node.onSubmit, `${path}.onSubmit`),
        disabled: readOptionalBoolean(node.disabled, `${path}.disabled`),
      };
    }
    case "select": {
      const field = readFormField(node, path, context);
      if (node.onChange == null && !field.name && node.disabled !== true) {
        fail(path, "requires onChange or a form field name");
      }
      if (!Array.isArray(node.options)) fail(`${path}.options`, "expected an array");
      if (node.options.length === 0) fail(`${path}.options`, "must contain at least one option");
      if (node.options.length > EXTENSION_VIEW_LIMITS.maxOptions) {
        fail(`${path}.options`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxOptions} options`);
      }
      const options = node.options.map((value, index) => {
        const option = readRecord(value, `${path}.options[${index}]`);
        return {
          label: readString(
            option.label,
            `${path}.options[${index}].label`,
            EXTENSION_VIEW_LIMITS.maxLabelLength,
          ),
          value: readString(
            option.value,
            `${path}.options[${index}].value`,
            EXTENSION_VIEW_LIMITS.maxLabelLength,
          ),
          disabled: readOptionalBoolean(option.disabled, `${path}.options[${index}].disabled`),
        };
      });
      if (new Set(options.map((option) => option.value)).size !== options.length) {
        fail(`${path}.options`, "must contain unique values");
      }
      return {
        type,
        ...field,
        label: readOptionalString(
          node.label,
          `${path}.label`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        value: readOptionalString(
          node.value,
          `${path}.value`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        placeholder: readOptionalString(
          node.placeholder,
          `${path}.placeholder`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        options,
        onChange: node.onChange == null ? undefined : readAction(node.onChange, `${path}.onChange`),
        disabled: readOptionalBoolean(node.disabled, `${path}.disabled`),
      };
    }
    case "toggle": {
      const field = readFormField(node, path, context);
      if (node.onChange == null && !field.name && node.disabled !== true) {
        fail(path, "requires onChange or a form field name");
      }
      return {
        type,
        ...field,
        label: readString(node.label, `${path}.label`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        description: readOptionalString(
          node.description,
          `${path}.description`,
          EXTENSION_VIEW_LIMITS.maxTextLength,
        ),
        checked: readBoolean(node.checked, `${path}.checked`),
        onChange: node.onChange == null ? undefined : readAction(node.onChange, `${path}.onChange`),
        disabled: readOptionalBoolean(node.disabled, `${path}.disabled`),
      };
    }
    case "checkbox": {
      const field = readFormField(node, path, context);
      if (node.onChange == null && !field.name && node.disabled !== true) {
        fail(path, "requires onChange or a form field name");
      }
      return {
        type,
        ...field,
        label: readString(node.label, `${path}.label`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        description: readOptionalString(
          node.description,
          `${path}.description`,
          EXTENSION_VIEW_LIMITS.maxTextLength,
        ),
        checked: readBoolean(node.checked, `${path}.checked`),
        onChange: node.onChange == null ? undefined : readAction(node.onChange, `${path}.onChange`),
        disabled: readOptionalBoolean(node.disabled, `${path}.disabled`),
      };
    }
    case "choice": {
      const field = readFormField(node, path, context);
      if (node.onChange == null && !field.name && node.disabled !== true) {
        fail(path, "requires onChange or a form field name");
      }
      if (!Array.isArray(node.options)) fail(`${path}.options`, "expected an array");
      if (node.options.length === 0) fail(`${path}.options`, "must contain at least one option");
      if (node.options.length > EXTENSION_VIEW_LIMITS.maxOptions) {
        fail(`${path}.options`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxOptions} options`);
      }
      const options = node.options.map((value, index) => {
        const option = readRecord(value, `${path}.options[${index}]`);
        return {
          label: readString(
            option.label,
            `${path}.options[${index}].label`,
            EXTENSION_VIEW_LIMITS.maxLabelLength,
          ),
          value: readString(
            option.value,
            `${path}.options[${index}].value`,
            EXTENSION_VIEW_LIMITS.maxLabelLength,
          ),
          disabled: readOptionalBoolean(option.disabled, `${path}.options[${index}].disabled`),
        };
      });
      if (new Set(options.map((option) => option.value)).size !== options.length) {
        fail(`${path}.options`, "must contain unique values");
      }

      const multiple = readOptionalBoolean(node.multiple, `${path}.multiple`) ?? false;
      let selected: string | string[];
      if (multiple) {
        if (!Array.isArray(node.value)) fail(`${path}.value`, "expected an array");
        selected = node.value.map((value, index) =>
          readString(value, `${path}.value[${index}]`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        );
        if (new Set(selected).size !== selected.length) {
          fail(`${path}.value`, "must contain unique values");
        }
      } else {
        if (Array.isArray(node.value)) fail(`${path}.value`, "expected a string");
        selected = readString(node.value, `${path}.value`, EXTENSION_VIEW_LIMITS.maxLabelLength);
      }

      const unavailableSelection = (Array.isArray(selected) ? selected : [selected]).find(
        (value) => !options.some((option) => option.value === value && !option.disabled),
      );
      if (unavailableSelection) {
        fail(`${path}.value`, "must reference enabled options");
      }

      return {
        type,
        ...field,
        label: readOptionalString(
          node.label,
          `${path}.label`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
        description: readOptionalString(
          node.description,
          `${path}.description`,
          EXTENSION_VIEW_LIMITS.maxTextLength,
        ),
        multiple,
        value: selected,
        options,
        onChange: node.onChange == null ? undefined : readAction(node.onChange, `${path}.onChange`),
        disabled: readOptionalBoolean(node.disabled, `${path}.disabled`),
      };
    }
    case "tabs": {
      if (!Array.isArray(node.tabs)) fail(`${path}.tabs`, "expected an array");
      if (node.tabs.length === 0) fail(`${path}.tabs`, "must contain at least one tab");
      if (node.tabs.length > EXTENSION_VIEW_LIMITS.maxOptions) {
        fail(`${path}.tabs`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxOptions} tabs`);
      }
      const tabs = node.tabs.map((value, index) => {
        const tab = readRecord(value, `${path}.tabs[${index}]`);
        return {
          value: readString(
            tab.value,
            `${path}.tabs[${index}].value`,
            EXTENSION_VIEW_LIMITS.maxLabelLength,
          ),
          label: readString(
            tab.label,
            `${path}.tabs[${index}].label`,
            EXTENSION_VIEW_LIMITS.maxLabelLength,
          ),
          children: readChildren(tab.children, `${path}.tabs[${index}].children`, depth, context),
          disabled: readOptionalBoolean(tab.disabled, `${path}.tabs[${index}].disabled`),
        };
      });
      if (new Set(tabs.map((tab) => tab.value)).size !== tabs.length) {
        fail(`${path}.tabs`, "must contain unique values");
      }
      const selectedValue = readOptionalString(
        node.value,
        `${path}.value`,
        EXTENSION_VIEW_LIMITS.maxLabelLength,
      );
      if (selectedValue && !tabs.some((tab) => tab.value === selectedValue && !tab.disabled)) {
        fail(`${path}.value`, "must reference an enabled tab");
      }
      return {
        type,
        value: selectedValue,
        tabs,
        onChange: node.onChange == null ? undefined : readAction(node.onChange, `${path}.onChange`),
      };
    }
    case "disclosure":
      return {
        type,
        title: readString(node.title, `${path}.title`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        description: readOptionalString(
          node.description,
          `${path}.description`,
          EXTENSION_VIEW_LIMITS.maxTextLength,
        ),
        open: readOptionalBoolean(node.open, `${path}.open`),
        children: readChildren(node.children, `${path}.children`, depth, context),
        onChange: node.onChange == null ? undefined : readAction(node.onChange, `${path}.onChange`),
      };
    case "keyValue": {
      if (!Array.isArray(node.items)) fail(`${path}.items`, "expected an array");
      if (node.items.length === 0) fail(`${path}.items`, "must contain at least one item");
      if (node.items.length > EXTENSION_VIEW_LIMITS.maxMetadataItems) {
        fail(
          `${path}.items`,
          `must contain at most ${EXTENSION_VIEW_LIMITS.maxMetadataItems} items`,
        );
      }
      return {
        type,
        items: node.items.map((value, index) => {
          const item = readRecord(value, `${path}.items[${index}]`);
          return {
            label: readString(
              item.label,
              `${path}.items[${index}].label`,
              EXTENSION_VIEW_LIMITS.maxLabelLength,
            ),
            value: readViewValue(item.value, `${path}.items[${index}].value`),
            tone: readOptionalEnum(item.tone, `${path}.items[${index}].tone`, VIEW_TONES),
            monospace: readOptionalBoolean(item.monospace, `${path}.items[${index}].monospace`),
          };
        }),
      };
    }
    case "tree": {
      if (!Array.isArray(node.items)) fail(`${path}.items`, "expected an array");
      if (node.items.length === 0) fail(`${path}.items`, "must contain at least one item");
      return {
        type,
        label: readString(node.label, `${path}.label`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        items: readTreeItems(node.items, `${path}.items`, 1, { items: 0, ids: new Set() }),
      };
    }
    case "listItem": {
      const badges = node.badges;
      if (badges != null && !Array.isArray(badges)) fail(`${path}.badges`, "expected an array");
      if (Array.isArray(badges) && badges.length > EXTENSION_VIEW_LIMITS.maxBadges) {
        fail(`${path}.badges`, `must contain at most ${EXTENSION_VIEW_LIMITS.maxBadges} badges`);
      }
      return {
        type,
        title: readString(node.title, `${path}.title`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        description: readOptionalString(
          node.description,
          `${path}.description`,
          EXTENSION_VIEW_LIMITS.maxTextLength,
        ),
        meta: readOptionalString(node.meta, `${path}.meta`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        badges: Array.isArray(badges)
          ? badges.map((badge, index) => readBadge(badge, `${path}.badges[${index}]`))
          : undefined,
        onSelect: node.onSelect == null ? undefined : readAction(node.onSelect, `${path}.onSelect`),
      };
    }
    case "empty":
      return {
        type,
        message: readString(node.message, `${path}.message`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        description: readOptionalString(
          node.description,
          `${path}.description`,
          EXTENSION_VIEW_LIMITS.maxTextLength,
        ),
      };
    case "loading":
      return {
        type,
        message: readOptionalString(
          node.message,
          `${path}.message`,
          EXTENSION_VIEW_LIMITS.maxLabelLength,
        ),
      };
    case "error":
      return {
        type,
        message: readString(node.message, `${path}.message`, EXTENSION_VIEW_LIMITS.maxLabelLength),
        description: readOptionalString(
          node.description,
          `${path}.description`,
          EXTENSION_VIEW_LIMITS.maxTextLength,
        ),
      };
    case "divider":
      return { type };
    default:
      fail(`${path}.type`, `unsupported node type "${type}"`);
  }
}

export function parseExtensionViewNode(value: unknown): ExtensionViewNode {
  assertPayloadBudget(value);
  return readNode(value, "$", 0, { nodes: 0, formDepth: 0 });
}
