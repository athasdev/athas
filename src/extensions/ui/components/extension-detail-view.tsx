import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowSquareOutIcon as OpenExternal,
  ArrowClockwiseIcon as RefreshCw,
  ArrowCounterClockwiseIcon as Reset,
  CheckIcon as Check,
  DownloadSimpleIcon as Download,
  PencilSimpleIcon as Pencil,
  TrashIcon as Trash,
  XCircleIcon as XCircle,
} from "@/ui/icons";
import { Alert, AlertDescription } from "@/ui/alert";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { hasSkillLocalOverride } from "@/features/ai/lib/skill-library";
import { ExtensionIcon } from "./extension-catalog-icon";
import type { UnifiedExtension } from "./extension-catalog-types";
import {
  canDeactivateAppearanceExtension,
  getCategoryLabel,
  getPrimaryActionLabel,
  isAppearanceExtension,
} from "./extension-catalog-utils";

interface ExtensionDetailViewProps {
  extension: UnifiedExtension | null;
  settings: { theme: string; iconTheme: string };
  isInstalling: (extension: UnifiedExtension) => boolean;
  hasUpdate: (extension: UnifiedExtension) => boolean;
  onUseAppearance: (extension: UnifiedExtension, selectionId?: string) => void | Promise<void>;
  onToggle: (extension: UnifiedExtension) => void | Promise<void>;
  onUninstall: (extension: UnifiedExtension) => void | Promise<void>;
  onUpdate: (extension: UnifiedExtension) => void | Promise<void>;
  onDeactivate: (extension: UnifiedExtension) => void | Promise<void>;
  onResetSkillOverride: (extension: UnifiedExtension) => void | Promise<void>;
  onEditSkill: (skillId: string) => void;
}

export function ExtensionDetailView({
  extension,
  settings,
  isInstalling,
  hasUpdate,
  onUseAppearance,
  onToggle,
  onUninstall,
  onUpdate,
  onDeactivate,
  onResetSkillOverride,
  onEditSkill,
}: ExtensionDetailViewProps) {
  if (!extension) {
    return <EmptyState layout="sidebar" message="Extension not found." />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <div className="flex items-start gap-4">
        <ExtensionIcon extension={extension} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-foreground ui-text-2xl">{extension.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-subtle-foreground ui-text-sm">
            {extension.publisher ? <span>By {extension.publisher}</span> : null}
            {extension.version ? <span>v{extension.version}</span> : null}
            {extension.license ? <span>{extension.license}</span> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="default" size="compact">
          {getCategoryLabel(extension.category)}
        </Badge>
        {extension.isInstalled ? (
          <Badge variant="accent" size="compact">
            Installed
          </Badge>
        ) : null}
        {extension.isInstalled && !extension.isEnabled ? (
          <Badge variant="default" size="compact">
            Disabled
          </Badge>
        ) : null}
        {hasUpdate(extension) ? (
          <Badge variant="accent" size="compact">
            Update
          </Badge>
        ) : null}
        {extension.isActive ? (
          <Badge variant="accent" size="compact">
            Active
          </Badge>
        ) : null}
        {extension.isBundled ? (
          <Badge variant="accent" size="compact">
            Built-in
          </Badge>
        ) : null}
      </div>

      {extension.description ? (
        <p className="leading-6 text-subtle-foreground ui-text-base">{extension.description}</p>
      ) : null}

      {extension.runtimeIssues?.length ? (
        <Alert tone="error">
          <AlertDescription>{extension.runtimeIssues[0]?.message}</AlertDescription>
        </Alert>
      ) : null}

      {isAppearanceExtension(extension) && extension.appearanceOptions?.length ? (
        <div className="border-border/70 border-t pt-5">
          <div className="mb-2 font-medium text-foreground ui-text-sm">
            {extension.category === "theme" ? "Themes" : "Icon themes"}
          </div>
          <div className="space-y-2">
            {extension.appearanceOptions.map((option) => {
              const currentSelection =
                extension.category === "theme" ? settings.theme : settings.iconTheme;
              const isCurrent = currentSelection === option.id;

              return (
                <div
                  key={option.id}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-border/65 bg-background px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground ui-text-sm">
                      {option.name}
                    </div>
                    {option.description ? (
                      <div className="mt-0.5 line-clamp-1 text-subtle-foreground ui-text-sm">
                        {option.description}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    variant={isCurrent ? "default" : "accent"}
                    size="xs"
                    active={isCurrent}
                    disabled={!extension.isInstalled || isCurrent}
                    onClick={() => void onUseAppearance(extension, option.id)}
                  >
                    <Check />
                    {isCurrent ? "Current" : extension.isEnabled ? "Use" : "Activate and use"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {extension.skill ? (
          <Button
            variant="accent"
            onClick={() => extension.skill && onEditSkill(extension.skill.id)}
          >
            <Pencil />
            Edit
          </Button>
        ) : null}
        {extension.sourceUrl ? (
          <Button
            variant="ghost"
            onClick={() => extension.sourceUrl && void openUrl(extension.sourceUrl)}
          >
            <OpenExternal />
            Source
          </Button>
        ) : null}
        {!extension.isBundled ? (
          <Button
            variant={
              isAppearanceExtension(extension) && extension.isActive
                ? "default"
                : isAppearanceExtension(extension) && extension.isInstalled
                  ? "accent"
                  : extension.isInstalled &&
                      (extension.category === "agent" || extension.category === "skill")
                    ? "ghost"
                    : extension.isInstalled && extension.isEnabled
                      ? "default"
                      : "accent"
            }
            className={
              extension.isInstalled &&
              (extension.category === "agent" || extension.category === "skill")
                ? "text-subtle-foreground hover:text-destructive"
                : undefined
            }
            onClick={() => void onToggle(extension)}
            disabled={
              (isAppearanceExtension(extension) && extension.isActive) ||
              isInstalling(extension) ||
              (extension.category === "agent" &&
                !extension.isInstalled &&
                extension.canInstall === false)
            }
          >
            {isAppearanceExtension(extension) && extension.isInstalled ? (
              <Check />
            ) : extension.isInstalled &&
              (extension.category === "agent" || extension.category === "skill") ? (
              <Trash />
            ) : extension.isInstalled && extension.isEnabled ? (
              <XCircle />
            ) : extension.isInstalled ? (
              <Check />
            ) : (
              <Download weight="fill" />
            )}
            {getPrimaryActionLabel(extension)}
          </Button>
        ) : null}
        {extension.isMarketplace &&
        extension.isInstalled &&
        extension.category !== "agent" &&
        extension.category !== "skill" ? (
          <Button
            variant="ghost"
            className="text-subtle-foreground hover:text-destructive"
            onClick={() => void onUninstall(extension)}
            disabled={isInstalling(extension)}
          >
            <Trash />
            Uninstall
          </Button>
        ) : null}
        {hasUpdate(extension) && extension.isInstalled ? (
          <Button
            variant="default"
            onClick={() => void onUpdate(extension)}
            disabled={isInstalling(extension)}
          >
            <RefreshCw />
            Update
          </Button>
        ) : null}
        {canDeactivateAppearanceExtension(extension) ? (
          <Button
            variant="ghost"
            className="text-subtle-foreground"
            onClick={() => void onDeactivate(extension)}
          >
            <XCircle />
            Deactivate
          </Button>
        ) : null}
        {extension.skill && hasSkillLocalOverride(extension.skill) ? (
          <Button variant="default" onClick={() => void onResetSkillOverride(extension)}>
            <Reset />
            Reset
          </Button>
        ) : null}
      </div>

      <div className="border-border/70 border-t pt-5">
        <div className="mb-2 font-medium text-foreground ui-text-sm">Contributions</div>
        <div className="flex flex-wrap gap-1.5">
          {(extension.contributionSummary?.length
            ? extension.contributionSummary
            : extension.extensions
              ? extension.extensions
              : [getCategoryLabel(extension.category)]
          ).map((item) => (
            <Badge key={item} variant="default">
              {item}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
