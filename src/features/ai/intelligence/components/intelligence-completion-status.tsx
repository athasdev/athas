import { useState } from "react";
import { ModelConnectionMenuList } from "@/features/ai/components/selectors/model-connection-picker";
import { useTabCompletionModel } from "@/features/ai/hooks/use-tab-completion-model";
import { useIntelligenceCompletionStore } from "@/features/editor/stores/intelligence-completion.store";
import type { IntelligenceCompletionStatus as CompletionStatus } from "@/features/editor/stores/intelligence-completion.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { Button, type ButtonProps } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItems,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  type MenuItem,
} from "@/ui/dropdown";
import { PauseIcon, SparkleIcon, WarningCircleIcon } from "@/ui/icons";
import { useMenuSearch } from "@/ui/menu-search";
import { Spinner } from "@/ui/spinner";

const PAUSE_TITLES = {
  credits: "Tab paused: plan or credits required",
  "sign-in": "Tab paused: sign in required",
  "api-key": "Tab paused: API key required",
  policy: "Tab disabled by your organization",
  model: "Tab paused: choose a model",
} as const;

function describeStatus(
  enabled: boolean,
  status: CompletionStatus,
): { title: string; detail: string | null; tone: ButtonProps["tone"] } {
  if (!enabled) return { title: "Tab autocomplete off", detail: null, tone: "default" };
  switch (status.kind) {
    case "loading":
      return { title: "Tab autocomplete: thinking", detail: null, tone: "default" };
    case "paused":
      return { title: PAUSE_TITLES[status.reason], detail: status.message, tone: "warning" };
    case "error":
      return { title: "Tab autocomplete error", detail: status.message, tone: "danger" };
    default:
      return { title: "Tab autocomplete on", detail: null, tone: "default" };
  }
}

export function IntelligenceCompletionStatus() {
  const enabled = useSettingsStore((state) => state.settings.aiCompletion);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const status = useIntelligenceCompletionStore.use.status();
  const { resume } = useIntelligenceCompletionStore.use.actions();
  const { title, detail, tone } = describeStatus(enabled, status);
  const showRetry = enabled && (status.kind === "paused" || status.kind === "error");
  const model = useTabCompletionModel();
  const modelSearch = useMenuSearch();
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const canChooseModel = enabled && model.allowed;

  const items: MenuItem[] = [
    ...(showRetry ? [{ id: "retry", label: "Retry now", onClick: resume }] : []),
    {
      id: "settings",
      label: "Tab completion settings",
      onClick: () => useUIState.getState().openSettings("ai-completion"),
    },
    {
      id: "toggle",
      label: "Tab autocomplete",
      checked: enabled,
      onClick: () => {
        resume();
        void updateSetting("aiCompletion", !enabled);
      },
    },
  ];

  return (
    <div className="relative flex items-center self-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              iconOnly
              tone={tone}
              aria-label={title}
              tooltip={title}
            />
          }
        >
          <span className="flex size-full items-center justify-center">
            {enabled && status.kind === "loading" ? (
              <Spinner label="Generating completion" compact />
            ) : enabled && status.kind === "paused" ? (
              <PauseIcon />
            ) : enabled && status.kind === "error" ? (
              <WarningCircleIcon />
            ) : (
              <SparkleIcon className={enabled ? undefined : "opacity-50"} />
            )}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" size="wide">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{title}</DropdownMenuLabel>
            <p className="px-2 pb-1 text-subtle-foreground ui-text-sm">
              {detail ??
                (enabled ? model.description : "Turn it on to get suggestions as you type")}
            </p>
          </DropdownMenuGroup>
          {canChooseModel ? (
            <DropdownMenuSub
              onOpenChange={(open) => {
                setIsModelMenuOpen(open);
                if (!open) modelSearch.reset();
              }}
            >
              <DropdownMenuSubTrigger disabled={model.locked}>
                Model
                <span
                  className="ml-auto min-w-0 max-w-40 truncate text-subtle-foreground ui-text-sm"
                  title={
                    model.providerName ? `${model.shortName} via ${model.providerName}` : undefined
                  }
                >
                  {model.isAutomatic && model.resolved
                    ? `Auto · ${model.shortName}`
                    : model.shortName}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent viewport="searchable" size="wide">
                <ModelConnectionMenuList
                  value={model.choice}
                  onChange={model.change}
                  inheritLabel="Automatic"
                  purpose="completion"
                  search={modelSearch}
                  isOpen={isModelMenuOpen}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItems items={items} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
