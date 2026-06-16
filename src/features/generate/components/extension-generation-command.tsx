import {
  ArrowLeftIcon as ArrowLeft,
  CheckIcon as Check,
  ClipboardTextIcon as ClipboardText,
  CursorClickIcon as CursorClick,
  PackageIcon as Package,
  RowsPlusTopIcon as Sidebar,
  SparkleIcon as Sparkles,
  TerminalWindowIcon as Terminal,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import {
  requestUIExtensionGeneration,
  type UIExtensionContributionType,
  type UIExtensionGenerationResult,
} from "@/extensions/ui/services/ui-extension-generation-service";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useGenerateStore } from "@/features/generate/stores/generate.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import Badge from "@/ui/badge";
import Command, {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandItemMeta,
  CommandItemTitle,
  CommandList,
} from "@/ui/command";
import { LoadingIndicator } from "@/ui/loading";
import { writeClipboardText } from "@/utils/clipboard";
import { matchesSearchQuery } from "@/utils/search-match";

type GenerationStep = "type" | "prompt" | "generating" | "result";

interface ContributionOption {
  id: UIExtensionContributionType;
  label: string;
  description: string;
  placeholder: string;
  icon: typeof Sidebar;
}

const CONTRIBUTION_OPTIONS: ContributionOption[] = [
  {
    id: "sidebar",
    label: "Sidebar view",
    description: "Generate a panel for dashboards, tools, and workspace data.",
    placeholder: "Project release dashboard with build status and quick rollback actions",
    icon: Sidebar,
  },
  {
    id: "toolbar",
    label: "Toolbar action",
    description: "Generate an editor action users can trigger from the toolbar.",
    placeholder: "Summarize the current file and show a short review checklist",
    icon: CursorClick,
  },
  {
    id: "command",
    label: "Command",
    description: "Generate a command palette action for a focused workflow.",
    placeholder: "Create a changelog draft from the current git diff",
    icon: Terminal,
  },
];

function getOption(id: UIExtensionContributionType | null) {
  return CONTRIBUTION_OPTIONS.find((option) => option.id === id) ?? CONTRIBUTION_OPTIONS[0];
}

export function ExtensionGenerationCommand() {
  const isVisible = useGenerateStore.use.isExtensionGenerationVisible();
  const { closeExtensionGeneration } = useGenerateStore.use.actions();
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);
  const { isAuthenticated, isPro } = useProFeature();
  const { signIn, isSigningIn } = useDesktopSignIn();
  const { showToast } = useToast();
  const [step, setStep] = useState<GenerationStep>("type");
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState<UIExtensionContributionType | null>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<UIExtensionGenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedOption = getOption(selectedType);
  const filteredOptions = useMemo(
    () =>
      CONTRIBUTION_OPTIONS.filter((option) =>
        matchesSearchQuery(query, [option.label, option.description]),
      ),
    [query],
  );

  useEffect(() => {
    if (!isVisible) {
      setStep("type");
      setQuery("");
      setSelectedType(null);
      setPrompt("");
      setResult(null);
      setError(null);
    }
  }, [isVisible]);

  const close = () => {
    closeExtensionGeneration();
  };

  const chooseType = (type: UIExtensionContributionType) => {
    setSelectedType(type);
    setPrompt("");
    setQuery("");
    setError(null);
    setStep("prompt");
  };

  const generate = async () => {
    if (!selectedType || !prompt.trim()) return;

    setStep("generating");
    setError(null);

    try {
      const generated = await requestUIExtensionGeneration({
        contributionType: selectedType,
        description: prompt.trim(),
      });

      setResult(generated);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Generation failed.");
    } finally {
      setStep("result");
    }
  };

  const copyCode = async () => {
    if (!result?.code) return;

    await writeClipboardText(result.code);
    showToast({ message: "Generated extension code copied", type: "success" });
  };

  const openExtensions = () => {
    close();
    openSettingsDialog("extensions");
  };

  const canGenerate = Boolean(selectedType && prompt.trim());
  const locked = !isAuthenticated || !isPro;

  return (
    <Command
      isVisible={isVisible}
      onClose={close}
      title="Generate extension"
      className="w-[560px] max-w-[calc(100vw-2rem)]"
    >
      {locked ? (
        <>
          <CommandHeader onClose={close}>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Sparkles className="size-4 shrink-0 text-accent" />
              <div className="min-w-0 truncate ui-font ui-text-sm text-text">
                Generate Extension
              </div>
              <Badge variant="muted" size="compact">
                Hosted
              </Badge>
            </div>
          </CommandHeader>
          <CommandList>
            <div className="p-3">
              <div className="rounded-lg border border-border/70 bg-secondary-bg/50 p-3">
                <div className="ui-font ui-text-sm font-medium text-text">
                  {isAuthenticated ? "Upgrade to generate extensions" : "Sign in to continue"}
                </div>
                <div className="mt-1 ui-font ui-text-xs leading-[1.45] text-text-lighter">
                  {isAuthenticated
                    ? "Hosted extension generation is available with Athas Pro."
                    : "Sign in with your Athas account to generate UI extensions."}
                </div>
              </div>
            </div>
          </CommandList>
          <CommandFooter>
            <CommandFooterAction onClick={close}>Close</CommandFooterAction>
            {isAuthenticated ? (
              <CommandFooterAction
                variant="accent"
                onClick={() =>
                  window.open("https://athas.dev/pricing", "_blank", "noopener,noreferrer")
                }
              >
                Upgrade
              </CommandFooterAction>
            ) : (
              <CommandFooterAction
                variant="accent"
                onClick={() => void signIn()}
                disabled={isSigningIn}
              >
                {isSigningIn ? "Signing in..." : "Sign in"}
              </CommandFooterAction>
            )}
          </CommandFooter>
        </>
      ) : step === "type" ? (
        <>
          <CommandHeader onClose={close}>
            <CommandInput
              value={query}
              onChange={setQuery}
              onKeyDown={(event) => {
                if (event.key === "Enter" && filteredOptions[0]) {
                  event.preventDefault();
                  chooseType(filteredOptions[0].id);
                }
              }}
              placeholder="What kind of extension?"
              size="md"
            />
          </CommandHeader>
          <CommandList>
            {filteredOptions.length === 0 ? (
              <CommandEmpty>No extension types found</CommandEmpty>
            ) : (
              filteredOptions.map((option, index) => {
                const Icon = option.icon;

                return (
                  <CommandItem
                    key={option.id}
                    isSelected={index === 0}
                    onClick={() => chooseType(option.id)}
                    className="px-3 py-2"
                  >
                    <Icon className="size-4 shrink-0 text-text-lighter" />
                    <div className="min-w-0 flex-1">
                      <CommandItemTitle>{option.label}</CommandItemTitle>
                      <CommandItemMeta className="ml-0 block">{option.description}</CommandItemMeta>
                    </div>
                  </CommandItem>
                );
              })
            )}
          </CommandList>
        </>
      ) : step === "prompt" ? (
        <>
          <CommandHeader onClose={close}>
            <CommandInput
              value={prompt}
              onChange={setPrompt}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canGenerate) {
                  event.preventDefault();
                  void generate();
                }
              }}
              placeholder={selectedOption.placeholder}
              size="md"
            />
          </CommandHeader>
          <CommandList>
            <div className="space-y-2 p-2">
              <div className="rounded-lg border border-border/70 bg-secondary-bg/50 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Package className="size-4 text-accent" />
                  <span className="ui-font ui-text-sm font-medium text-text">
                    {selectedOption.label}
                  </span>
                </div>
                <p className="ui-font ui-text-xs leading-[1.45] text-text-lighter">
                  Describe the workflow, data it should show, and the action a user should take.
                </p>
              </div>
              {prompt.trim() ? (
                <div className="rounded-lg border border-border/60 bg-primary-bg/60 p-3 ui-font ui-text-xs leading-[1.45] text-text">
                  {prompt}
                </div>
              ) : null}
            </div>
          </CommandList>
          <CommandFooter>
            <CommandFooterAction
              onClick={() => {
                setStep("type");
                setPrompt("");
              }}
            >
              <ArrowLeft />
              Type
            </CommandFooterAction>
            <CommandFooterAction
              variant="accent"
              onClick={() => void generate()}
              disabled={!canGenerate}
            >
              <Sparkles />
              Generate
            </CommandFooterAction>
          </CommandFooter>
        </>
      ) : step === "generating" ? (
        <>
          <CommandHeader onClose={close}>
            <div className="flex min-w-0 flex-1 items-center gap-2 ui-font ui-text-sm text-text">
              <Sparkles className="size-4 shrink-0 text-accent" />
              Generating {selectedOption.label.toLowerCase()}
            </div>
          </CommandHeader>
          <div className="flex min-h-40 items-center justify-center">
            <LoadingIndicator label="Generating" showLabel />
          </div>
        </>
      ) : (
        <>
          <CommandHeader onClose={close}>
            <div className="flex min-w-0 flex-1 items-center gap-2 ui-font ui-text-sm text-text">
              {error ? (
                <Sparkles className="size-4 shrink-0 text-error" />
              ) : (
                <Check className="size-4 shrink-0 text-success" />
              )}
              {error ? "Generation failed" : "Extension generated"}
            </div>
          </CommandHeader>
          <CommandList>
            <div className="space-y-2 p-2">
              {error ? (
                <div className="rounded-lg border border-error/30 bg-error/10 p-3 ui-font ui-text-xs leading-[1.45] text-error">
                  {error}
                </div>
              ) : result ? (
                <>
                  <div className="rounded-lg border border-border/70 bg-secondary-bg/50 p-3">
                    <div className="ui-font ui-text-sm font-medium text-text">{result.name}</div>
                    <div className="mt-1 ui-font ui-text-xs leading-[1.45] text-text-lighter">
                      {result.description}
                    </div>
                  </div>
                  <div className="max-h-40 overflow-hidden rounded-lg border border-border/60 bg-primary-bg/70">
                    <pre className="custom-scrollbar-thin max-h-40 overflow-auto p-3 editor-font text-[length:var(--ui-text-xs)] leading-[1.45] text-text-lighter">
                      {result.code}
                    </pre>
                  </div>
                </>
              ) : null}
            </div>
          </CommandList>
          <CommandFooter>
            <CommandFooterAction
              onClick={() => {
                setStep("prompt");
                setError(null);
              }}
            >
              <ArrowLeft />
              Prompt
            </CommandFooterAction>
            {result?.code ? (
              <CommandFooterAction onClick={() => void copyCode()}>
                <ClipboardText />
                Copy code
              </CommandFooterAction>
            ) : null}
            <CommandFooterAction
              variant={error ? "danger" : "accent"}
              onClick={error ? () => void generate() : openExtensions}
            >
              {error ? "Try again" : "Extensions"}
            </CommandFooterAction>
          </CommandFooter>
        </>
      )}
    </Command>
  );
}
