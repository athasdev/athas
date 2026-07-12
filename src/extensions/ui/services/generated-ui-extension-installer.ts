import { createElement, type ReactNode } from "react";
import { Button } from "@/ui/button";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIExtensionStore } from "../stores/ui-extension-store";
import type { Disposable, UIExtensionRegistration } from "../types/ui-extension";

type GeneratedContributionType = NonNullable<UIExtensionRegistration["contributionType"]>;

export interface GeneratedUIExtension {
  id: string;
  name: string;
  description: string;
  contributionType: GeneratedContributionType;
  code: string;
}

type UIStyle = Record<string, unknown>;
const GENERATED_EXTENSIONS_STORAGE_KEY = "athas.generated-ui-extensions";
const GENERATED_UI_FONT_SIZE = "var(--ui-text-sm)";

function toChildrenArray(children: unknown[] | unknown): ReactNode[] {
  return (Array.isArray(children) ? children : [children]).filter(
    (child) => child != null,
  ) as ReactNode[];
}

function normalizeGeneratedExtensionId(id: string) {
  const normalized = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `generated.${normalized || Date.now().toString(36)}`;
}

function readStoredGeneratedExtensions(): GeneratedUIExtension[] {
  const raw = localStorage.getItem(GENERATED_EXTENSIONS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (extension): extension is GeneratedUIExtension =>
        extension &&
        typeof extension === "object" &&
        typeof extension.id === "string" &&
        typeof extension.name === "string" &&
        typeof extension.description === "string" &&
        typeof extension.code === "string" &&
        ["sidebar", "toolbar", "command"].includes(extension.contributionType),
    );
  } catch {
    return [];
  }
}

function storeGeneratedExtension(extension: GeneratedUIExtension) {
  const storedExtensions = readStoredGeneratedExtensions();
  const nextExtensions = [
    ...storedExtensions.filter((storedExtension) => storedExtension.id !== extension.id),
    extension,
  ];

  localStorage.setItem(GENERATED_EXTENSIONS_STORAGE_KEY, JSON.stringify(nextExtensions));
}

function createGeneratedExtensionAPI(extensionId: string) {
  const store = useUIExtensionStore.getState();
  const storagePrefix = `ui-ext-${extensionId}-`;

  return {
    sidebar: {
      registerView(config: { id: string; title: string; icon: string; render: () => ReactNode }) {
        store.registerSidebarView({
          id: config.id,
          extensionId,
          title: config.title,
          icon: config.icon || "puzzle-piece",
          render: () => {
            const content = config.render();

            if (typeof content === "string") {
              return createElement("div", {
                dangerouslySetInnerHTML: { __html: content },
                className: "font-sans ui-text-sm h-full overflow-auto text-text",
              });
            }

            return content;
          },
        });

        return { dispose: () => store.unregisterSidebarView(config.id) } satisfies Disposable;
      },
    },
    toolbar: {
      registerAction(config: {
        id: string;
        title: string;
        icon: string;
        position: "left" | "right";
        onClick: () => void;
        isVisible?: () => boolean;
      }) {
        store.registerToolbarAction({ ...config, extensionId });
        return { dispose: () => store.unregisterToolbarAction(config.id) } satisfies Disposable;
      },
    },
    commands: {
      register(
        id: string,
        title: string,
        handler: (...args: unknown[]) => void | Promise<void>,
        category?: string,
      ) {
        store.registerCommand({ id, extensionId, title, category, execute: handler });
        return { dispose: () => store.unregisterCommand(id) } satisfies Disposable;
      },
      async execute(commandId: string, ...args: unknown[]) {
        const command = useUIExtensionStore.getState().commands.get(commandId);
        if (command) {
          await command.execute(...args);
        }
      },
    },
    dialog: {
      open(config: {
        id: string;
        title: string;
        render: () => ReactNode;
        width?: number;
        height?: number;
      }) {
        store.openDialog({ ...config, extensionId });
      },
      close(dialogId: string) {
        store.closeDialog(dialogId);
      },
    },
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        const raw = localStorage.getItem(`${storagePrefix}${key}`);
        if (raw === null) return undefined;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return undefined;
        }
      },
      async set<T>(key: string, value: T): Promise<void> {
        localStorage.setItem(`${storagePrefix}${key}`, JSON.stringify(value));
      },
      async delete(key: string): Promise<void> {
        localStorage.removeItem(`${storagePrefix}${key}`);
      },
    },
    editor: {
      getActiveFilePath() {
        const bufferState = useBufferStore.getState();
        const active = bufferState.buffers.find(
          (buffer) => buffer.id === bufferState.activeBufferId,
        );
        return active?.path ?? null;
      },
      getActiveFileContent() {
        const bufferState = useBufferStore.getState();
        const active = bufferState.buffers.find(
          (buffer) => buffer.id === bufferState.activeBufferId,
        );
        if (active && "content" in active && typeof active.content === "string") {
          return active.content;
        }
        return null;
      },
    },
    ui: {
      stack(config: {
        children?: unknown[] | unknown;
        gap?: number;
        padding?: number;
        style?: UIStyle;
      }) {
        const { children, gap = 12, padding = 0, style } = config;
        return createElement(
          "div",
          {
            className: "font-sans",
            style: {
              display: "flex",
              flexDirection: "column",
              gap: `${gap}px`,
              padding: `${padding}px`,
              color: "var(--color-text)",
              ...style,
              fontSize: GENERATED_UI_FONT_SIZE,
            },
          },
          ...toChildrenArray(children),
        );
      },
      row(config: {
        children?: unknown[] | unknown;
        gap?: number;
        align?: string;
        justify?: string;
        style?: UIStyle;
      }) {
        const { children, gap = 8, align = "center", justify = "space-between", style } = config;
        return createElement(
          "div",
          {
            className: "font-sans",
            style: {
              display: "flex",
              alignItems: align,
              justifyContent: justify,
              gap: `${gap}px`,
              color: "var(--color-text)",
              ...style,
              fontSize: GENERATED_UI_FONT_SIZE,
            },
          },
          ...toChildrenArray(children),
        );
      },
      card(config: { children?: unknown[] | unknown; padding?: number; style?: UIStyle }) {
        const { children, padding = 12, style } = config;
        return createElement(
          "div",
          {
            className: "font-sans",
            style: {
              border: "1px solid var(--color-border)",
              background: "color-mix(in srgb, var(--color-secondary-bg) 92%, transparent)",
              borderRadius: "12px",
              padding: `${padding}px`,
              color: "var(--color-text)",
              ...style,
              fontSize: GENERATED_UI_FONT_SIZE,
            },
          },
          ...toChildrenArray(children),
        );
      },
      text(config: {
        children?: unknown[] | unknown;
        tone?: "default" | "muted" | "accent";
        size?: "xs" | "sm" | "md" | "lg";
        weight?: number;
        style?: UIStyle;
      }) {
        const { children, tone = "default", weight = 400, style } = config;
        const color =
          tone === "muted"
            ? "var(--color-text-lighter)"
            : tone === "accent"
              ? "var(--color-accent)"
              : "var(--color-text)";

        return createElement(
          "div",
          {
            className: "font-sans",
            style: {
              color,
              fontWeight: weight,
              lineHeight: 1.45,
              ...style,
              fontSize: GENERATED_UI_FONT_SIZE,
            },
          },
          ...toChildrenArray(children),
        );
      },
      badge(config: { label: string; tone?: "default" | "accent" | "muted"; style?: UIStyle }) {
        const { label, tone = "default", style } = config;
        const palette =
          tone === "accent"
            ? {
                color: "var(--color-accent)",
                background: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)",
              }
            : {
                color: tone === "muted" ? "var(--color-text-lighter)" : "var(--color-text)",
                background: "color-mix(in srgb, var(--color-secondary-bg) 72%, transparent)",
                border: "1px solid var(--color-border)",
              };

        return createElement(
          "span",
          {
            className: "font-sans",
            style: {
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "999px",
              padding: "4px 8px",
              fontWeight: 500,
              ...palette,
              ...style,
              fontSize: GENERATED_UI_FONT_SIZE,
            },
          },
          label,
        );
      },
      button(config: { label: string; onClick: () => void; variant?: "default" | "accent" }) {
        const { label, onClick, variant = "default" } = config;
        return createElement(
          Button,
          { onClick, variant, compact: true, style: { fontSize: GENERATED_UI_FONT_SIZE } },
          label,
        );
      },
      input(config: {
        value?: string;
        placeholder?: string;
        type?: string;
        readOnly?: boolean;
        style?: UIStyle;
      }) {
        const { value = "", placeholder, type = "text", readOnly = true, style } = config;
        return createElement("input", {
          className: "font-sans",
          defaultValue: value,
          placeholder,
          type,
          readOnly,
          style: {
            width: "100%",
            height: "30px",
            borderRadius: "10px",
            border: "1px solid var(--color-border)",
            background: "var(--color-secondary-bg)",
            color: "var(--color-text)",
            padding: "0 10px",
            outline: "none",
            ...style,
            fontSize: GENERATED_UI_FONT_SIZE,
          },
        });
      },
      metric(config: {
        label: string;
        value: string;
        tone?: "default" | "accent" | "muted";
        style?: UIStyle;
      }) {
        const { label, value, tone = "default", style } = config;
        return createElement(
          "div",
          {
            className: "font-sans",
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              border: "1px solid var(--color-border)",
              borderRadius: "12px",
              padding: "10px 12px",
              background:
                tone === "accent"
                  ? "color-mix(in srgb, var(--color-accent) 10%, var(--color-secondary-bg))"
                  : "color-mix(in srgb, var(--color-secondary-bg) 92%, transparent)",
              ...style,
            },
          },
          createElement(
            "div",
            {
              style: {
                color: "var(--color-text-lighter)",
                fontSize: GENERATED_UI_FONT_SIZE,
                lineHeight: 1.4,
              },
            },
            label,
          ),
          createElement(
            "div",
            {
              style: {
                color: tone === "accent" ? "var(--color-accent)" : "var(--color-text)",
                fontSize: GENERATED_UI_FONT_SIZE,
                fontWeight: 600,
                lineHeight: 1.2,
              },
            },
            value,
          ),
        );
      },
      sectionHeader(config: {
        title: string;
        subtitle?: string;
        action?: ReactNode;
        style?: UIStyle;
      }) {
        const { title, subtitle, action, style } = config;
        return createElement(
          "div",
          {
            className: "font-sans",
            style: {
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "12px",
              ...style,
            },
          },
          createElement(
            "div",
            { style: { minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" } },
            createElement(
              "div",
              {
                style: {
                  color: "var(--color-text)",
                  fontSize: GENERATED_UI_FONT_SIZE,
                  fontWeight: 600,
                },
              },
              title,
            ),
            subtitle
              ? createElement(
                  "div",
                  {
                    style: {
                      color: "var(--color-text-lighter)",
                      fontSize: GENERATED_UI_FONT_SIZE,
                      lineHeight: 1.45,
                    },
                  },
                  subtitle,
                )
              : null,
          ),
          action ?? null,
        );
      },
      listItem(config: {
        title: string;
        subtitle?: string;
        trailing?: ReactNode;
        tone?: "default" | "accent";
        style?: UIStyle;
      }) {
        const { title, subtitle, trailing, tone = "default", style } = config;
        return createElement(
          "div",
          {
            className: "font-sans",
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              border: "1px solid var(--color-border)",
              borderRadius: "10px",
              padding: "10px 12px",
              background:
                tone === "accent"
                  ? "color-mix(in srgb, var(--color-accent) 8%, var(--color-secondary-bg))"
                  : "color-mix(in srgb, var(--color-secondary-bg) 88%, transparent)",
              ...style,
            },
          },
          createElement(
            "div",
            { style: { minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" } },
            createElement(
              "div",
              {
                style: {
                  color: "var(--color-text)",
                  fontSize: GENERATED_UI_FONT_SIZE,
                  fontWeight: 500,
                },
              },
              title,
            ),
            subtitle
              ? createElement(
                  "div",
                  {
                    style: {
                      color: "var(--color-text-lighter)",
                      fontSize: GENERATED_UI_FONT_SIZE,
                      lineHeight: 1.4,
                    },
                  },
                  subtitle,
                )
              : null,
          ),
          trailing ?? null,
        );
      },
      emptyState(config: {
        title: string;
        description?: string;
        action?: ReactNode;
        style?: UIStyle;
      }) {
        const { title, description, action, style } = config;
        return createElement(
          "div",
          {
            className: "font-sans",
            style: {
              border: "1px dashed var(--color-border)",
              borderRadius: "12px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              alignItems: "flex-start",
              background: "color-mix(in srgb, var(--color-secondary-bg) 70%, transparent)",
              ...style,
            },
          },
          createElement(
            "div",
            {
              style: {
                color: "var(--color-text)",
                fontSize: GENERATED_UI_FONT_SIZE,
                fontWeight: 600,
              },
            },
            title,
          ),
          description
            ? createElement(
                "div",
                {
                  style: {
                    color: "var(--color-text-lighter)",
                    fontSize: GENERATED_UI_FONT_SIZE,
                    lineHeight: 1.45,
                  },
                },
                description,
              )
            : null,
          action ?? null,
        );
      },
      divider() {
        return createElement("div", {
          style: { height: "1px", width: "100%", background: "var(--color-border)" },
        });
      },
    },
  };
}

export function installGeneratedUIExtension(
  extension: GeneratedUIExtension,
  options: { persist?: boolean } = {},
) {
  const store = useUIExtensionStore.getState();
  const extensionId = normalizeGeneratedExtensionId(extension.id);

  if (store.extensions.has(extensionId)) {
    store.cleanupExtension(extensionId);
  }

  store.registerExtension({
    extensionId,
    manifestId: extensionId,
    name: extension.name,
    description: extension.description,
    contributionType: extension.contributionType,
    state: "loading",
  });

  try {
    const api = createGeneratedExtensionAPI(extensionId);
    const activate = Function("api", `"use strict";\n${extension.code}`);
    activate(api);
    store.updateExtensionState(extensionId, "active");
    if (options.persist !== false) {
      storeGeneratedExtension(extension);
    }
    return { extensionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Install failed";
    store.updateExtensionState(extensionId, "error", message);
    throw new Error(message);
  }
}

export function initializeGeneratedUIExtensions() {
  const storedExtensions = readStoredGeneratedExtensions();

  for (const extension of storedExtensions) {
    try {
      installGeneratedUIExtension(extension, { persist: false });
    } catch (error) {
      console.error("Failed to initialize generated UI extension:", error);
    }
  }
}
