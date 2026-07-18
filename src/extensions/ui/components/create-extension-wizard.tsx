import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CheckIcon as Check,
  RowsPlusTopIcon as Columns3,
  SignInIcon as LogIn,
  CursorClickIcon as MousePointerClick,
  PuzzlePieceIcon as Puzzle,
  SparkleIcon as Sparkles,
  TerminalWindowIcon as Terminal,
} from "@/ui/icons";
import { createElement, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useProFeature } from "../hooks/use-pro-feature";
import { requestUIExtensionGeneration } from "../services/ui-extension-generation-service";
import { useUIExtensionStore } from "../stores/ui-extension-store";
import { getServiceUrls } from "@/config/services";

type ContributionType = "sidebar" | "toolbar" | "command";

interface ContributionOption {
  id: ContributionType;
  label: string;
  description: string;
  icon: typeof Columns3;
}

const CONTRIBUTION_OPTIONS: ContributionOption[] = [
  {
    id: "sidebar",
    label: "Sidebar View",
    description: "A panel in the sidebar with custom content",
    icon: Columns3,
  },
  {
    id: "toolbar",
    label: "Toolbar Action",
    description: "A button in the editor toolbar",
    icon: MousePointerClick,
  },
  {
    id: "command",
    label: "Command",
    description: "A command accessible from the command palette",
    icon: Terminal,
  },
];

type WizardStep = "type" | "describe" | "generating" | "done";

const GENERATING_MESSAGES = [
  "Sketching the first pass...",
  "Laying out the interface...",
  "Tightening the structure...",
  "Preparing installable code...",
];
const GENERATED_UI_FONT_SIZE = "var(--ui-text-sm)";

interface GeneratedExtension {
  id: string;
  name: string;
  description: string;
  contributionType: ContributionType;
  code: string;
}

export function CreateExtensionWizard({ onClose }: { onClose: () => void }) {
  const { isAuthenticated, hasHostedAi } = useProFeature();
  const { signIn, isSigningIn } = useDesktopSignIn();
  const [step, setStep] = useState<WizardStep>("type");
  const [selectedType, setSelectedType] = useState<ContributionType | null>(null);
  const [description, setDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedExtension, setGeneratedExtension] = useState<GeneratedExtension | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generationMessageIndex, setGenerationMessageIndex] = useState(0);
  const [isInstalled, setIsInstalled] = useState(false);
  const abortRef = useRef(false);

  useEffect(() => {
    if (step !== "generating") {
      setGenerationMessageIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setGenerationMessageIndex((current) => (current + 1) % GENERATING_MESSAGES.length);
    }, 1800);

    return () => window.clearInterval(intervalId);
  }, [step]);

  const handleSelectType = (type: ContributionType) => {
    setSelectedType(type);
    setStep("describe");
  };

  const handleBack = () => {
    if (step === "describe") {
      setStep("type");
      setDescription("");
    } else if (step === "done") {
      setStep("describe");
      setGeneratedExtension(null);
      setError(null);
      setIsInstalled(false);
    }
  };

  const handleGenerate = useCallback(async () => {
    if (!selectedType || !description.trim()) return;

    setStep("generating");
    setIsGenerating(true);
    setError(null);
    setGenerationMessageIndex(0);
    abortRef.current = false;

    try {
      const parsed = await requestUIExtensionGeneration({
        contributionType: selectedType,
        description: description.trim(),
      });

      if (abortRef.current) return;

      setGeneratedExtension({
        id: parsed.id || `ext-${Date.now()}`,
        name: parsed.name || "Untitled Extension",
        description: parsed.description || "",
        contributionType: selectedType,
        code: parsed.code || "",
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setStep("done");
    } finally {
      setIsGenerating(false);
    }
  }, [selectedType, description]);

  const handleInstall = useCallback(() => {
    if (!generatedExtension) return;

    const store = useUIExtensionStore.getState();
    const extensionId = `user.${generatedExtension.id}`;

    store.registerExtension({
      extensionId,
      manifestId: extensionId,
      name: generatedExtension.name,
      description: generatedExtension.description,
      contributionType: generatedExtension.contributionType,
      state: "loading",
    });

    try {
      const toChildrenArray = (children: unknown) =>
        (Array.isArray(children) ? children : [children]).filter((child) => child != null);

      const api = {
        sidebar: {
          registerView(config: { id: string; title: string; icon: string; render: () => string }) {
            store.registerSidebarView({
              id: config.id,
              extensionId,
              title: config.title,
              icon: config.icon || "puzzle",
              render: () => {
                const content = config.render();

                if (typeof content === "string") {
                  return createElement("div", {
                    dangerouslySetInnerHTML: { __html: content },
                    style: { height: "100%", overflow: "auto", fontSize: GENERATED_UI_FONT_SIZE },
                  });
                }

                return content;
              },
            });
          },
        },
        toolbar: {
          registerAction(config: {
            id: string;
            title: string;
            icon: string;
            position: "left" | "right";
            onClick: () => void;
          }) {
            store.registerToolbarAction({
              id: config.id,
              extensionId,
              title: config.title,
              icon: config.icon,
              position: config.position,
              onClick: config.onClick,
            });
          },
        },
        commands: {
          register(
            id: string,
            title: string,
            handler: (...args: unknown[]) => void | Promise<void>,
            category?: string,
          ) {
            store.registerCommand({
              id,
              extensionId,
              title,
              category,
              execute: handler,
            });
          },
        },
        ui: {
          stack(config: {
            children?: unknown[] | unknown;
            gap?: number;
            padding?: number;
            style?: Record<string, unknown>;
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
            style?: Record<string, unknown>;
          }) {
            const {
              children,
              gap = 8,
              align = "center",
              justify = "space-between",
              style,
            } = config;
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
          card(config: {
            children?: unknown[] | unknown;
            padding?: number;
            style?: Record<string, unknown>;
          }) {
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
            style?: Record<string, unknown>;
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
          badge(config: {
            label: string;
            tone?: "default" | "accent" | "muted";
            style?: Record<string, unknown>;
          }) {
            const { label, tone = "default", style } = config;
            const palette =
              tone === "accent"
                ? {
                    color: "var(--color-accent)",
                    background: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)",
                  }
                : tone === "muted"
                  ? {
                      color: "var(--color-text-lighter)",
                      background: "color-mix(in srgb, var(--color-secondary-bg) 72%, transparent)",
                      border: "1px solid var(--color-border)",
                    }
                  : {
                      color: "var(--color-text)",
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
              {
                onClick,
                variant,
                size: "xs",
                style: { fontSize: GENERATED_UI_FONT_SIZE },
              },
              label,
            );
          },
          input(config: {
            value?: string;
            placeholder?: string;
            type?: string;
            readOnly?: boolean;
            style?: Record<string, unknown>;
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
            style?: Record<string, unknown>;
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
            style?: Record<string, unknown>;
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
            style?: Record<string, unknown>;
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
            style?: Record<string, unknown>;
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
              style: {
                height: "1px",
                width: "100%",
                background: "var(--color-border)",
              },
            });
          },
        },
      };

      void api;
      throw new Error(
        "Generated extension installation is disabled until generated code runs in a sandbox.",
      );
    } catch (err) {
      store.updateExtensionState(
        extensionId,
        "error",
        err instanceof Error ? err.message : "Install failed",
      );
      setError(`Installation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [generatedExtension]);

  const renderLockedState = () => {
    const title = isAuthenticated ? "Upgrade to generate extensions" : "Sign in to continue";
    const description = isAuthenticated
      ? "Hosted UI generation is available on Athas Pro. Upgrade your account to generate and install extensions directly in the app."
      : "Sign in with your Athas account to generate and install extensions directly in the app.";

    return (
      <div className="flex h-full flex-col">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Puzzle className="size-4 text-accent" />
            <h3 className="font-medium ui-text-sm text-text">Create UI Extension</h3>
          </div>
          <Badge variant="muted" size="compact">
            Hosted
          </Badge>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-4">
          <div className="rounded-xl border border-border/60 bg-secondary-bg/40 p-4">
            <p className="font-medium ui-text-sm text-text">{title}</p>
            <p className="mt-1 text-text-lighter ui-text-sm">{description}</p>
          </div>

          <div className="grid gap-2 ui-text-sm text-text-lighter">
            <div className="rounded-lg border border-border/50 bg-primary-bg/30 p-3">
              Sidebar views for custom tools and dashboards
            </div>
            <div className="rounded-lg border border-border/50 bg-primary-bg/30 p-3">
              Toolbar actions for file and editor workflows
            </div>
            <div className="rounded-lg border border-border/50 bg-primary-bg/30 p-3">
              Commands for quick actions in the command palette
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose} variant="ghost" size="xs">
              Close
            </Button>
            {isAuthenticated ? (
              <Button
                onClick={() =>
                  window.open(getServiceUrls().pricingUrl, "_blank", "noopener,noreferrer")
                }
                variant="accent"
                size="xs"
              >
                Upgrade to Pro
              </Button>
            ) : (
              <Button
                onClick={() => void signIn()}
                variant="accent"
                size="xs"
                disabled={isSigningIn}
                className="gap-1.5"
              >
                <LogIn className="size-3.5" />
                {isSigningIn ? "Signing in..." : "Sign in"}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!isAuthenticated || !hasHostedAi) {
    return renderLockedState();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {step !== "type" && (
            <Button
              onClick={handleBack}
              variant="ghost"
              aria-label="Go back"
              disabled={isGenerating}
              size="icon-xs"
            >
              <ArrowLeft />
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Puzzle className="size-4 text-accent" />
            <h3 className="font-medium ui-text-sm text-text">
              {step === "type" && "Create UI Extension"}
              {step === "describe" && "Describe your extension"}
              {step === "generating" && "Generating extension"}
              {step === "done" && (error ? "Something went wrong" : "Extension ready")}
            </h3>
          </div>
        </div>
        <Badge variant="muted" size="compact">
          Hosted
        </Badge>
      </div>

      {step === "type" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-border/60 bg-secondary-bg/40 p-4">
            <p className="font-medium ui-text-sm text-text">Build a UI extension from a prompt</p>
            <p className="mt-1 text-text-lighter ui-text-sm">
              Choose where it should live, describe the workflow, then install it directly into
              Athas.
            </p>
          </div>
          {CONTRIBUTION_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelectType(option.id)}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-secondary-bg/40 p-3 text-left transition-colors hover:border-border-strong hover:bg-hover"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-bg/60">
                <option.icon className="size-4 text-text" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium ui-text-sm text-text">{option.label}</p>
                <p className="text-text-lighter ui-text-sm">{option.description}</p>
              </div>
              <ArrowRight className="ml-auto size-4 text-text-lighter" />
            </button>
          ))}
        </div>
      )}

      {step === "describe" && (
        <div className="flex flex-1 flex-col gap-3">
          <div className="rounded-lg border border-border/60 bg-secondary-bg/30 p-3">
            <p className="font-medium ui-text-sm text-text">
              {CONTRIBUTION_OPTIONS.find((o) => o.id === selectedType)?.label}
            </p>
            <p className="mt-1 text-text-lighter ui-text-sm">
              Describe what it should show, what actions it should support, and how the user should
              interact with it.
            </p>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              selectedType === "sidebar"
                ? "e.g., A project releases panel that lists recent builds, deployment status, and quick rollback actions."
                : selectedType === "toolbar"
                  ? "e.g., A toolbar button that summarizes the current file and opens the result in a side panel."
                  : "e.g., A command that generates a changelog draft from the current git diff."
            }
            className="min-h-[120px] flex-1 resize-none rounded-lg border border-border bg-secondary-bg px-3 py-2 ui-text-sm text-text placeholder:text-text-lighter/60 transition-[border-color,box-shadow,background-color] focus:border-border-strong focus:bg-secondary-bg focus:outline-none focus:ring-1 focus:ring-border-strong/35"
            autoFocus
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-text-lighter ui-text-sm">
              Hosted generation. No user API key required.
            </p>
            <Button
              onClick={handleGenerate}
              variant="accent"
              disabled={!description.trim()}
              className="gap-1.5"
              size="xs"
            >
              <Sparkles className="size-3.5" />
              Generate
            </Button>
          </div>
        </div>
      )}

      {step === "generating" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <LoadingIndicator label="Generating" showLabel />
          <p className="min-h-4 text-center text-text-lighter ui-text-sm">
            {GENERATING_MESSAGES[generationMessageIndex]}
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-1 flex-col gap-3">
          {error ? (
            <div className="rounded-lg border border-error/30 bg-error/10 p-3">
              <p className="text-error ui-text-sm">{error}</p>
            </div>
          ) : generatedExtension ? (
            <>
              <div className="rounded-lg border border-border/60 bg-secondary-bg/40 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Check className="size-4 text-success" />
                  <span className="font-medium ui-text-sm text-text">
                    {generatedExtension.name}
                  </span>
                </div>
                <p className="text-text-lighter ui-text-sm">{generatedExtension.description}</p>
              </div>

              {isInstalled ? (
                <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
                  <Check className="size-4 text-success" />
                  <p className="text-success ui-text-sm">
                    Extension installed and active.
                    {generatedExtension.contributionType === "sidebar" &&
                      " Check the sidebar for your new view."}
                    {generatedExtension.contributionType === "toolbar" &&
                      " Check the editor toolbar for your new action."}
                  </p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={handleInstall} variant="accent" className="gap-1.5" size="xs">
                    <Puzzle className="size-3.5" />
                    Install
                  </Button>
                  <Button onClick={handleBack} variant="default" size="xs">
                    Try another prompt
                  </Button>
                </div>
              )}
            </>
          ) : null}

          {(isInstalled || error) && (
            <Button onClick={onClose} variant="ghost" className="self-end" size="xs">
              Done
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
