import { useIntelligenceCompletionStore } from "@/features/editor/stores/intelligence-completion.store";
import type { IntelligenceCompletionStatus as CompletionStatus } from "@/features/editor/stores/intelligence-completion.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button, type ButtonProps } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItems,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  type MenuItem,
} from "@/ui/dropdown";
import { PauseIcon, SparkleIcon, WarningCircleIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";

const PAUSE_TITLES = {
  credits: "Tab paused: plan or credits required",
  "sign-in": "Tab paused: sign in required",
  "api-key": "Tab paused: API key required",
  policy: "Tab disabled by your organization",
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

  const items: MenuItem[] = [
    ...(showRetry ? [{ id: "retry", label: "Retry now", onClick: resume }] : []),
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
            {detail ? (
              <p className="px-2 pb-1 text-subtle-foreground ui-text-sm">{detail}</p>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuItems items={items} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
