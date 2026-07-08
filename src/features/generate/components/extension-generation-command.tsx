import {
  ArrowLeftIcon as ArrowLeft,
  CheckIcon as Check,
  CursorClickIcon as CursorClick,
  PackageIcon as Package,
  RowsPlusTopIcon as Sidebar,
  SparkleIcon as Sparkles,
  TerminalWindowIcon as Terminal,
} from "@phosphor-icons/react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  requestUIExtensionGeneration,
  type UIExtensionContributionType,
  type UIExtensionGenerationResult,
} from "@/extensions/ui/services/ui-extension-generation-service";
import { installGeneratedUIExtension } from "@/extensions/ui/services/generated-ui-extension-installer";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useGenerateStore } from "@/features/generate/stores/generate.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import Command, {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandHeaderBadge,
  CommandInput,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { LoadingIndicator } from "@/ui/loading";
import Textarea from "@/ui/textarea";
import { matchesSearchQuery } from "@/utils/search-match";

type GenerationStep = "type" | "intent" | "details" | "generating" | "preview" | "installed";

interface ContributionOption {
  id: UIExtensionContributionType;
  label: string;
  description: string;
  detailPrompt: string;
  icon: typeof Sidebar;
}

interface IntentOption {
  id: string;
  label: string;
  description: string;
  detailPrompt: string;
}

const CONTRIBUTION_OPTIONS: ContributionOption[] = [
  {
    id: "sidebar",
    label: "Sidebar view",
    description: "Panel",
    detailPrompt: "Project release dashboard with build status and rollback actions",
    icon: Sidebar,
  },
  {
    id: "toolbar",
    label: "Toolbar action",
    description: "Editor button",
    detailPrompt: "Summarize the current file and show a short review checklist",
    icon: CursorClick,
  },
  {
    id: "command",
    label: "Command",
    description: "Palette action",
    detailPrompt: "Create a changelog draft from the current git diff",
    icon: Terminal,
  },
];

const INTENT_OPTIONS: Record<UIExtensionContributionType, IntentOption[]> = {
  sidebar: [
    {
      id: "status",
      label: "Track project status",
      description: "Metrics, lists, and next actions",
      detailPrompt: "What status should the panel track?",
    },
    {
      id: "review",
      label: "Review work",
      description: "Queues, checks, and decisions",
      detailPrompt: "What should the review surface help decide?",
    },
    {
      id: "reference",
      label: "Keep reference nearby",
      description: "Docs, notes, and shortcuts",
      detailPrompt: "What reference content should stay visible?",
    },
  ],
  toolbar: [
    {
      id: "analyze",
      label: "Analyze current file",
      description: "Inspect, summarize, or check",
      detailPrompt: "What should the toolbar action analyze?",
    },
    {
      id: "transform",
      label: "Transform selection",
      description: "Rewrite or prepare output",
      detailPrompt: "What should it transform and where should the result go?",
    },
    {
      id: "open-helper",
      label: "Open a helper",
      description: "Launch a small focused tool",
      detailPrompt: "What helper should open from the toolbar?",
    },
  ],
  command: [
    {
      id: "draft",
      label: "Draft something",
      description: "Generate useful text",
      detailPrompt: "What should the command draft?",
    },
    {
      id: "inspect",
      label: "Inspect workspace",
      description: "Read context and report",
      detailPrompt: "What should the command inspect?",
    },
    {
      id: "workflow",
      label: "Run a workflow",
      description: "Do one repeatable task",
      detailPrompt: "What workflow should the command run?",
    },
  ],
};

const GENERATING_MESSAGES = [
  "Reading your selections",
  "Designing the extension surface",
  "Preparing an installable extension",
  "Building the preview",
];

function getOption(id: UIExtensionContributionType | null) {
  return CONTRIBUTION_OPTIONS.find((option) => option.id === id) ?? CONTRIBUTION_OPTIONS[0];
}

function getIntent(
  contributionType: UIExtensionContributionType | null,
  intentId: string | null,
): IntentOption | null {
  if (!contributionType) return null;
  return INTENT_OPTIONS[contributionType].find((option) => option.id === intentId) ?? null;
}

function getPreviewHighlights(
  result: UIExtensionGenerationResult,
  selectedOption: ContributionOption,
  selectedIntent: IntentOption | null,
) {
  const previewHighlights = result.preview?.highlights?.filter(Boolean) ?? [];
  if (previewHighlights.length > 0) return previewHighlights.slice(0, 3);

  return [
    `${selectedOption.label} contribution`,
    selectedIntent?.description ?? selectedOption.description,
    result.description,
  ].filter(Boolean);
}

export function ExtensionGenerationCommand() {
  const isVisible = useGenerateStore.use.isExtensionGenerationVisible();
  const { closeExtensionGeneration } = useGenerateStore.use.actions();
  const setActiveView = useUIState((state) => state.setActiveView);
  const setIsSidebarVisible = useUIState((state) => state.setIsSidebarVisible);
  const { isAuthenticated, isPro } = useProFeature();
  const { signIn, isSigningIn } = useDesktopSignIn();
  const { showToast } = useToast();
  const [step, setStep] = useState<GenerationStep>("type");
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState<UIExtensionContributionType | null>(null);
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [result, setResult] = useState<UIExtensionGenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [generationMessageIndex, setGenerationMessageIndex] = useState(0);
  const [isInstalling, setIsInstalling] = useState(false);
  const generationRunRef = useRef(0);
  const isVisibleRef = useRef(isVisible);

  const selectedOption = getOption(selectedType);
  const selectedIntent = getIntent(selectedType, selectedIntentId);
  const intentOptions = selectedType ? INTENT_OPTIONS[selectedType] : [];
  const filteredTypeOptions = useMemo(
    () =>
      CONTRIBUTION_OPTIONS.filter((option) =>
        matchesSearchQuery(query, [option.label, option.description]),
      ),
    [query],
  );
  const filteredIntentOptions = useMemo(
    () =>
      intentOptions.filter((option) =>
        matchesSearchQuery(query, [option.label, option.description]),
      ),
    [intentOptions, query],
  );
  const visibleOptionCount =
    step === "type"
      ? filteredTypeOptions.length
      : step === "intent"
        ? filteredIntentOptions.length
        : 0;
  const activeTypeOption = filteredTypeOptions[selectedIndex] ?? filteredTypeOptions[0] ?? null;
  const activeIntentOption =
    filteredIntentOptions[selectedIndex] ?? filteredIntentOptions[0] ?? null;
  const canGenerate = Boolean(selectedType && selectedIntent && details.trim());
  const locked = !isAuthenticated || !isPro;

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      generationRunRef.current += 1;
      setStep("type");
      setQuery("");
      setSelectedType(null);
      setSelectedIntentId(null);
      setDetails("");
      setResult(null);
      setError(null);
      setSelectedIndex(0);
      setGenerationMessageIndex(0);
      setIsInstalling(false);
    }
  }, [isVisible]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, step]);

  useEffect(() => {
    setSelectedIndex((currentIndex) =>
      visibleOptionCount === 0 ? 0 : Math.min(currentIndex, visibleOptionCount - 1),
    );
  }, [visibleOptionCount]);

  useEffect(() => {
    if (step !== "generating") {
      setGenerationMessageIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setGenerationMessageIndex((currentIndex) => (currentIndex + 1) % GENERATING_MESSAGES.length);
    }, 1600);

    return () => window.clearInterval(intervalId);
  }, [step]);

  const close = () => {
    generationRunRef.current += 1;
    closeExtensionGeneration();
  };

  const goToType = () => {
    setStep("type");
    setQuery("");
    setSelectedType(null);
    setSelectedIntentId(null);
    setDetails("");
    setResult(null);
    setError(null);
  };

  const chooseType = (type: UIExtensionContributionType) => {
    setSelectedType(type);
    setSelectedIntentId(null);
    setQuery("");
    setError(null);
    setStep("intent");
  };

  const chooseIntent = (intent: IntentOption) => {
    setSelectedIntentId(intent.id);
    setQuery("");
    setDetails("");
    setError(null);
    setStep("details");
  };

  const generate = async () => {
    if (!selectedType || !selectedIntent || !details.trim()) return;

    const runId = generationRunRef.current + 1;
    generationRunRef.current = runId;
    setStep("generating");
    setError(null);
    setResult(null);
    setGenerationMessageIndex(0);

    const description = [
      `Surface: ${selectedOption.label}`,
      `User choice: ${selectedIntent.label}`,
      `Intent: ${selectedIntent.description}`,
      `Details: ${details.trim()}`,
    ].join("\n");

    try {
      const generated = await requestUIExtensionGeneration({
        contributionType: selectedType,
        description,
      });

      if (generationRunRef.current !== runId || !isVisibleRef.current) return;

      setResult(generated);
    } catch (generationError) {
      if (generationRunRef.current !== runId || !isVisibleRef.current) return;

      setError(generationError instanceof Error ? generationError.message : "Generation failed.");
    }

    if (generationRunRef.current !== runId || !isVisibleRef.current) return;

    setStep("preview");
  };

  const install = () => {
    if (!result || !selectedType) return;

    setIsInstalling(true);
    setError(null);

    try {
      const installed = installGeneratedUIExtension({
        ...result,
        contributionType: selectedType,
      });

      if (selectedType === "sidebar") {
        setActiveView(installed.extensionId);
        setIsSidebarVisible(true);
      }
      setStep("installed");
      showToast({ message: "Extension installed", type: "success" });
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : "Install failed.");
    } finally {
      setIsInstalling(false);
    }
  };

  const openExtensions = () => {
    close();
    useBufferStore.getState().actions.openExtensionsBuffer();
  };

  const moveSelection = (delta: number) => {
    setSelectedIndex((currentIndex) => {
      if (visibleOptionCount === 0) return 0;
      return Math.min(Math.max(currentIndex + delta, 0), visibleOptionCount - 1);
    });
  };

  const handlePickerKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (step === "type" && activeTypeOption) {
        chooseType(activeTypeOption.id);
      } else if (step === "intent" && activeIntentOption) {
        chooseIntent(activeIntentOption);
      }
    }
  };

  const renderPickerItem = (
    option: ContributionOption | IntentOption,
    index: number,
    onSelect: () => void,
    Icon?: ContributionOption["icon"],
  ) => (
    <CommandItemRow
      key={option.id}
      isSelected={index === selectedIndex}
      onClick={onSelect}
      onMouseEnter={() => setSelectedIndex(index)}
      icon={Icon ? <Icon className="size-4 text-text-lighter" /> : undefined}
      title={option.label}
      description={option.description}
    />
  );

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
              <div className="min-w-0 truncate ui-font ui-text-base text-text">
                Generate Extension
              </div>
              <CommandHeaderBadge>Hosted</CommandHeaderBadge>
            </div>
          </CommandHeader>
          <CommandList>
            <div className="p-3">
              <div className="rounded-lg border border-border/70 bg-secondary-bg/50 p-3">
                <div className="ui-font ui-text-base font-medium text-text">
                  {isAuthenticated ? "Upgrade to generate extensions" : "Sign in to continue"}
                </div>
                <div className="mt-1 ui-font ui-text-base leading-[1.45] text-text-lighter">
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
                onClick={() =>
                  window.open("https://athas.dev/pricing", "_blank", "noopener,noreferrer")
                }
              >
                Upgrade
              </CommandFooterAction>
            ) : (
              <CommandFooterAction onClick={() => void signIn()} disabled={isSigningIn}>
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
              onKeyDown={handlePickerKeyDown}
              placeholder="What should I generate?"
            />
          </CommandHeader>
          <CommandList>
            {filteredTypeOptions.length === 0 ? (
              <CommandEmpty>No extension types found</CommandEmpty>
            ) : (
              filteredTypeOptions.map((option, index) =>
                renderPickerItem(option, index, () => chooseType(option.id), option.icon),
              )
            )}
          </CommandList>
        </>
      ) : step === "intent" ? (
        <>
          <CommandHeader onClose={close}>
            <CommandInput
              value={query}
              onChange={setQuery}
              onKeyDown={handlePickerKeyDown}
              placeholder="What should it help with?"
            />
          </CommandHeader>
          <CommandList>
            {filteredIntentOptions.length === 0 ? (
              <CommandEmpty>No matching choices</CommandEmpty>
            ) : (
              filteredIntentOptions.map((option, index) =>
                renderPickerItem(option, index, () => chooseIntent(option)),
              )
            )}
          </CommandList>
          <CommandFooter>
            <CommandFooterAction onClick={goToType}>
              <ArrowLeft />
              Type
            </CommandFooterAction>
          </CommandFooter>
        </>
      ) : step === "details" ? (
        <>
          <CommandHeader onClose={close}>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Package className="size-4 shrink-0 text-accent" />
              <div className="min-w-0 truncate ui-font ui-text-base text-text">
                {selectedIntent?.detailPrompt ?? selectedOption.detailPrompt}
              </div>
            </div>
          </CommandHeader>
          <CommandList>
            <div className="space-y-2 p-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border/70 bg-secondary-bg/50 px-3 py-2">
                  <div className="ui-font ui-text-base text-text-lighter">Surface</div>
                  <div className="mt-0.5 truncate ui-font ui-text-base text-text">
                    {selectedOption.label}
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary-bg/50 px-3 py-2">
                  <div className="ui-font ui-text-base text-text-lighter">Behavior</div>
                  <div className="mt-0.5 truncate ui-font ui-text-base text-text">
                    {selectedIntent?.label}
                  </div>
                </div>
              </div>
              <Textarea
                aria-label="Extension details"
                data-command-input=""
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canGenerate) {
                    event.preventDefault();
                    void generate();
                  }
                }}
                placeholder={selectedOption.detailPrompt}
                className="min-h-28 resize-none bg-primary-bg/70 ui-text-base leading-[1.45]"
              />
            </div>
          </CommandList>
          <CommandFooter>
            <CommandFooterAction
              onClick={() => {
                setStep("intent");
                setQuery("");
              }}
            >
              <ArrowLeft />
              Choice
            </CommandFooterAction>
            <CommandFooterAction onClick={() => void generate()} disabled={!canGenerate}>
              <Sparkles />
              Generate
            </CommandFooterAction>
          </CommandFooter>
        </>
      ) : step === "generating" ? (
        <>
          <CommandHeader onClose={close}>
            <div className="flex min-w-0 flex-1 items-center gap-2 ui-font ui-text-base text-text">
              <Sparkles className="size-4 shrink-0 text-accent" />
              Generating {selectedOption.label.toLowerCase()}
            </div>
          </CommandHeader>
          <div className="flex min-h-40 flex-col items-center justify-center gap-2">
            <LoadingIndicator label={GENERATING_MESSAGES[generationMessageIndex]} showLabel />
            <div className="ui-font ui-text-base text-text-lighter">
              {selectedIntent?.label ?? selectedOption.label}
            </div>
          </div>
        </>
      ) : step === "installed" ? (
        <>
          <CommandHeader onClose={close}>
            <div className="flex min-w-0 flex-1 items-center gap-2 ui-font ui-text-base text-text">
              <Check className="size-4 shrink-0 text-success" />
              Extension installed
            </div>
          </CommandHeader>
          <CommandList>
            <div className="space-y-2 p-2">
              <div className="rounded-lg border border-success/30 bg-success/10 p-3">
                <div className="ui-font ui-text-base font-medium text-text">{result?.name}</div>
                <div className="mt-1 ui-font ui-text-base leading-[1.45] text-text-lighter">
                  {selectedType === "sidebar"
                    ? "The new sidebar view is open now."
                    : selectedType === "toolbar"
                      ? "The new toolbar action is active in the editor."
                      : "The new command is available from the command palette."}
                </div>
              </div>
            </div>
          </CommandList>
          <CommandFooter>
            <CommandFooterAction onClick={close}>Done</CommandFooterAction>
            <CommandFooterAction onClick={openExtensions}>Extensions</CommandFooterAction>
          </CommandFooter>
        </>
      ) : (
        <>
          <CommandHeader onClose={close}>
            <div className="flex min-w-0 flex-1 items-center gap-2 ui-font ui-text-base text-text">
              {error ? (
                <Sparkles className="size-4 shrink-0 text-error" />
              ) : (
                <Check className="size-4 shrink-0 text-success" />
              )}
              {error ? "Generation failed" : "Preview extension"}
            </div>
          </CommandHeader>
          <CommandList>
            <div className="space-y-2 p-2">
              {error ? (
                <div className="rounded-lg border border-error/30 bg-error/10 p-3 ui-font ui-text-base leading-[1.45] text-error">
                  {error}
                </div>
              ) : result ? (
                <>
                  <div className="rounded-lg border border-border/70 bg-secondary-bg/50 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Package className="size-4 shrink-0 text-accent" />
                      <div className="min-w-0 truncate ui-font ui-text-base font-medium text-text">
                        {result.preview?.title ?? result.name}
                      </div>
                    </div>
                    <div className="mt-1 ui-font ui-text-base leading-[1.45] text-text-lighter">
                      {result.preview?.summary ?? result.description}
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    {getPreviewHighlights(result, selectedOption, selectedIntent).map(
                      (highlight) => (
                        <div
                          key={highlight}
                          className="flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-primary-bg/70 px-3 ui-font ui-text-base text-text"
                        >
                          <Check className="size-3.5 shrink-0 text-success" />
                          <span className="min-w-0 truncate">{highlight}</span>
                        </div>
                      ),
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </CommandList>
          <CommandFooter>
            <CommandFooterAction
              onClick={() => {
                setStep("details");
                setError(null);
              }}
            >
              <ArrowLeft />
              Details
            </CommandFooterAction>
            {error ? (
              <CommandFooterAction onClick={() => void generate()}>Try again</CommandFooterAction>
            ) : (
              <CommandFooterAction onClick={install} disabled={!result || isInstalling}>
                {isInstalling ? "Installing..." : result?.preview?.primaryAction || "Install"}
              </CommandFooterAction>
            )}
          </CommandFooter>
        </>
      )}
    </Command>
  );
}
