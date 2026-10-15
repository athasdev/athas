import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { CloudIcon, LaptopIcon } from "@/ui/icons";
import { IS_MAC, IS_WINDOWS } from "@/utils/platform";
import type { AgentEnvironment } from "../hooks/use-agent-environment";
import type { CloudTargets } from "../hooks/use-cloud-targets";
import {
  type AgentEnvironmentKind,
  CLOUD_MAX_MINUTES_OPTIONS,
} from "../services/cloud-environment";
import { useCloudEnvironmentStore } from "../stores/cloud-environment.store";
import { CloudBranchPicker, CloudRepoPicker } from "./cloud-target-pickers";

const THIS_MACHINE = IS_MAC ? "This Mac" : IS_WINDOWS ? "This PC" : "This computer";

function formatMinutes(minutes: number) {
  return minutes % 60 === 0
    ? `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`
    : `${minutes} min`;
}

/** Local or Cloud, with the cloud run's time limit and key choice tucked under it. */
function EnvironmentMenu({
  environment,
  onBeforeOpen,
}: {
  environment: AgentEnvironment;
  onBeforeOpen?: () => void;
}) {
  const preferences = useCloudEnvironmentStore.use.preferences();
  const { setPreferences } = useCloudEnvironmentStore.use.actions();
  const isCloud = environment.kind === "cloud";
  const label = isCloud ? "Cloud" : "Local";

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onBeforeOpen?.();
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            truncate
            disabled={environment.locked}
            aria-label={`Runs: ${label}`}
            tooltip={
              environment.locked
                ? isCloud
                  ? "This session runs in the cloud"
                  : "This session runs on this machine"
                : "Where the agent runs"
            }
          />
        }
      >
        {isCloud ? <CloudIcon /> : <LaptopIcon />}
        <span className="min-w-0 truncate">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" size="default">
        <DropdownMenuRadioGroup
          value={environment.kind}
          onValueChange={(kind: AgentEnvironmentKind) => environment.setKind(kind)}
        >
          <DropdownMenuRadioItem value="local" closeOnClick>
            <LaptopIcon />
            <span className="min-w-0 flex-1 truncate">Local</span>
            <span className="shrink-0 text-subtle-foreground ui-text-caption">{THIS_MACHINE}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="cloud" closeOnClick>
            <CloudIcon />
            <span className="min-w-0 flex-1 truncate">Cloud</span>
            <span className="shrink-0 text-subtle-foreground ui-text-caption">
              Opens a pull request
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {isCloud ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Cloud run</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger value={formatMinutes(preferences.maxMinutes)}>
                  Time limit
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent size="compact">
                  <DropdownMenuRadioGroup
                    value={String(preferences.maxMinutes)}
                    onValueChange={(value: string) => setPreferences({ maxMinutes: Number(value) })}
                  >
                    {CLOUD_MAX_MINUTES_OPTIONS.map((minutes) => (
                      <DropdownMenuRadioItem key={minutes} value={String(minutes)} closeOnClick>
                        {formatMinutes(minutes)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuCheckboxItem
                checked={preferences.useOwnKey}
                onCheckedChange={(checked) => setPreferences({ useOwnKey: checked })}
              >
                Use my own API key
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The composer's environment chips: Local or Cloud, and for Cloud the repository and branch the
 * run starts from. Hidden for accounts without cloud agents and for a local session that has
 * already started; a started cloud session keeps its repository and branch in its Environment box.
 */
export function ComposerEnvironmentControls({
  environment,
  targets,
  onBeforeOpen,
}: {
  environment: AgentEnvironment;
  targets: CloudTargets;
  onBeforeOpen?: () => void;
}) {
  const { hasCloudAgents } = useProFeature();
  if (!hasCloudAgents) return null;
  if (environment.locked && environment.kind === "local") return null;

  return (
    <>
      <EnvironmentMenu environment={environment} onBeforeOpen={onBeforeOpen} />
      {environment.kind === "cloud" && !environment.locked ? (
        <>
          <CloudRepoPicker
            environment={environment}
            targets={targets}
            variant="pill"
            onBeforeOpen={onBeforeOpen}
          />
          <CloudBranchPicker
            environment={environment}
            targets={targets}
            variant="pill"
            onBeforeOpen={onBeforeOpen}
          />
        </>
      ) : null}
    </>
  );
}
