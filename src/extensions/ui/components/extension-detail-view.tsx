import { openExternalUrl } from "@/utils/external-url";
import type { ReactNode } from "react";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CheckIcon,
  DownloadIcon,
  OpenExternalIcon,
  PenIcon,
  TrashIcon,
  XCircleIcon,
} from "@/ui/icons";
import { Alert, AlertDescription } from "@/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/accordion";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { Card, CardContent } from "@/ui/card";
import { Spinner } from "@/ui/spinner";
import { WorkbenchContent } from "@/ui/workbench";
import { GroupedSection } from "@/ui/grouped-section";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/item";
import MarkdownRenderer from "@/features/ai/components/messages/markdown-renderer";
import { hasSkillLocalOverride } from "@/features/ai/lib/skill-library";
import { AppearancePreviewGraphic } from "@/extensions/appearance/components/appearance-preview";
import { ExtensionIcon } from "./extension-catalog-icon";
import type {
  AppearanceSelection,
  ExtensionCatalogActions,
  UnifiedExtension,
} from "./extension-catalog-types";
import {
  canDeactivateAppearanceExtension,
  getCategoryLabel,
  getPrimaryActionLabel,
  isAppearanceExtension,
} from "./extension-catalog-utils";

/** Skill instructions are lazy-loaded by the surface, so their state arrives as one slot. */
interface SkillPreviewState {
  isLoading: boolean;
  error?: string;
  onOpen: () => void;
}

interface ExtensionDetailViewProps {
  breadcrumb?: ReactNode;
  extension: UnifiedExtension | null;
  appearanceSelection: AppearanceSelection;
  actions: ExtensionCatalogActions;
  onEditSkill: (skillId: string) => void;
  skillPreview: SkillPreviewState;
}

export function ExtensionDetailView({
  breadcrumb,
  extension,
  appearanceSelection,
  actions,
  onEditSkill,
  skillPreview,
}: ExtensionDetailViewProps) {
  if (!extension) {
    return <EmptyState layout="sidebar" message="Integration not found." />;
  }

  const skillContent = extension.skill?.content ?? extension.marketplaceSkill?.content;
  const isInstalling = actions.isInstalling(extension);
  const hasUpdate = actions.hasUpdate(extension);

  const headerActions = (
    <>
      {extension.skill ? (
        <Button variant="accent" onClick={() => extension.skill && onEditSkill(extension.skill.id)}>
          <PenIcon />
          Edit
        </Button>
      ) : null}
      {extension.sourceUrl ? (
        <Button
          variant="ghost"
          onClick={() => extension.sourceUrl && void openExternalUrl(extension.sourceUrl)}
        >
          <OpenExternalIcon />
          Source
        </Button>
      ) : null}
      {!extension.isBundled ? (
        <Button
          variant={
            isAppearanceExtension(extension)
              ? extension.isActive || !extension.isInstalled
                ? extension.isActive
                  ? "default"
                  : "accent"
                : "accent"
              : extension.isInstalled && extension.isEnabled
                ? "default"
                : "accent"
          }
          tone={
            !isAppearanceExtension(extension) &&
            extension.isInstalled &&
            (extension.category === "agent" || extension.category === "skill")
              ? "danger"
              : "default"
          }
          onClick={() => void actions.toggle(extension)}
          disabled={
            (isAppearanceExtension(extension) && extension.isActive) ||
            isInstalling ||
            (extension.category === "agent" &&
              !extension.isInstalled &&
              extension.canInstall === false)
          }
        >
          {isAppearanceExtension(extension) && extension.isInstalled ? (
            <CheckIcon />
          ) : extension.isInstalled &&
            (extension.category === "agent" || extension.category === "skill") ? (
            <TrashIcon />
          ) : extension.isInstalled && extension.isEnabled ? (
            <XCircleIcon />
          ) : extension.isInstalled ? (
            <CheckIcon />
          ) : (
            <DownloadIcon optical="md" />
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
          tone="danger"
          onClick={() => void actions.uninstall(extension)}
          disabled={isInstalling}
        >
          <TrashIcon />
          Uninstall
        </Button>
      ) : null}
      {hasUpdate && extension.isInstalled ? (
        <Button
          variant="default"
          onClick={() => void actions.update(extension)}
          disabled={isInstalling}
        >
          <ArrowClockwiseIcon />
          Update
        </Button>
      ) : null}
      {canDeactivateAppearanceExtension(extension) ? (
        <Button
          variant="ghost"
          disabled={isInstalling}
          onClick={() => void actions.deactivate(extension)}
        >
          <XCircleIcon />
          Deactivate
        </Button>
      ) : null}
      {extension.skill && hasSkillLocalOverride(extension.skill) ? (
        <Button variant="default" onClick={() => void actions.resetSkillOverride(extension)}>
          <ArrowCounterClockwiseIcon />
          Reset
        </Button>
      ) : null}
    </>
  );

  const metadata = [
    ["Category", getCategoryLabel(extension.category)],
    ["Version", extension.installedVersion ?? extension.version],
    ["Latest version", hasUpdate ? extension.availableVersion : undefined],
    ["Publisher", extension.publisher],
    ["Source", extension.sourceUrl],
    ["License", extension.license],
    [
      "Distribution",
      extension.distribution ??
        (extension.isBundled ? "Built-in" : extension.isMarketplace ? "Athas catalog" : "Local"),
    ],
  ].filter((entry) => entry[1]);

  return (
    <WorkbenchContent
      key={extension.id}
      title={extension.name}
      description={extension.description}
      width="narrow"
      breadcrumb={breadcrumb}
      leading={<ExtensionIcon extension={extension} />}
      actions={headerActions}
      status={
        <>
          {isInstalling ? (
            <Spinner label="Installing" showLabel compact />
          ) : (
            <Badge tone={extension.isInstalled && extension.isEnabled ? "success" : "neutral"}>
              {extension.isActive
                ? "Active"
                : extension.isInstalled
                  ? extension.isEnabled
                    ? "Installed"
                    : "Disabled"
                  : "Not installed"}
            </Badge>
          )}
          {hasUpdate ? <Badge tone="accent">Update available</Badge> : null}
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {extension.installNote && !extension.isInstalled ? (
          <Alert>
            <AlertDescription>{extension.installNote}</AlertDescription>
          </Alert>
        ) : null}

        {extension.runtimeIssues?.length ? (
          <Alert tone="error">
            <AlertDescription>{extension.runtimeIssues[0]?.message}</AlertDescription>
          </Alert>
        ) : null}

        <GroupedSection title="Details">
          {metadata.map(([label, value]) => (
            <Item key={label} variant="list">
              <ItemContent>
                <ItemDescription>{label}</ItemDescription>
              </ItemContent>
              <ItemActions className="min-w-0">
                <span className="truncate" title={value ?? undefined}>
                  {value}
                </span>
              </ItemActions>
            </Item>
          ))}
        </GroupedSection>

        {isAppearanceExtension(extension) && extension.appearanceOptions?.length ? (
          <GroupedSection title={extension.category === "theme" ? "Themes" : "Icons"}>
            {extension.appearanceOptions.map((option) => {
              const isCurrent =
                (extension.category === "theme"
                  ? appearanceSelection.theme
                  : appearanceSelection.iconTheme) === option.id;
              return (
                <Item key={option.id} variant="list">
                  {option.preview ? (
                    <ItemMedia>
                      <AppearancePreviewGraphic preview={option.preview} size="detail" />
                    </ItemMedia>
                  ) : null}
                  <ItemContent>
                    <ItemTitle>{option.name}</ItemTitle>
                    {option.description ? (
                      <ItemDescription>{option.description}</ItemDescription>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant={isCurrent ? "ghost" : "default"}
                      disabled={!extension.isInstalled || isCurrent || isInstalling}
                      onClick={() => void actions.applyAppearance(extension, option.id)}
                    >
                      <CheckIcon />
                      {isCurrent ? "Current" : extension.isEnabled ? "Use" : "Activate and use"}
                    </Button>
                  </ItemActions>
                </Item>
              );
            })}
          </GroupedSection>
        ) : null}

        {extension.category === "skill" ? (
          <GroupedSection title="Instructions" variant="bare">
            <Accordion
              key={extension.id}
              defaultValue={[]}
              onValueChange={(value) => {
                if (value.includes("instructions")) skillPreview.onOpen();
              }}
            >
              <AccordionItem value="instructions">
                <AccordionTrigger>Skill instructions</AccordionTrigger>
                <AccordionContent className="gap-3 pt-2">
                  {skillPreview.isLoading ? (
                    <Spinner label="Loading skill instructions" showLabel />
                  ) : skillPreview.error ? (
                    <Alert tone="error">
                      <AlertDescription>{skillPreview.error}</AlertDescription>
                    </Alert>
                  ) : skillContent ? (
                    <Card>
                      <CardContent className="min-w-0 overflow-hidden">
                        <MarkdownRenderer content={skillContent} />
                      </CardContent>
                    </Card>
                  ) : (
                    <Alert>
                      <AlertDescription>
                        This skill does not provide previewable instructions.
                      </AlertDescription>
                    </Alert>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </GroupedSection>
        ) : null}

        <GroupedSection title="Contributions">
          {(extension.contributionSummary?.length
            ? extension.contributionSummary
            : extension.extensions
              ? extension.extensions
              : [getCategoryLabel(extension.category)]
          ).map((item) => (
            <Item key={item} variant="list">
              <ItemMedia variant="icon">
                <CheckIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{item}</ItemTitle>
              </ItemContent>
            </Item>
          ))}
        </GroupedSection>
      </div>
    </WorkbenchContent>
  );
}
