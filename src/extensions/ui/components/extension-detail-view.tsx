import { openUrl } from "@tauri-apps/plugin-opener";
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
import { ResourceContentSection } from "@/ui/resource";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/ui/item";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/ui/table";
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
    return <EmptyState layout="sidebar" message="Extension not found." />;
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
          onClick={() => extension.sourceUrl && void openUrl(extension.sourceUrl)}
        >
          <OpenExternalIcon />
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
                  ? "danger"
                  : extension.isInstalled && extension.isEnabled
                    ? "default"
                    : "accent"
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
          variant="danger"
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
    ["Publisher", extension.publisher],
    ["Version", extension.installedVersion ?? extension.version],
    ["License", extension.license],
    [
      "Distribution",
      extension.isBundled ? "Built-in" : extension.isMarketplace ? "Marketplace" : "Local",
    ],
  ].filter((entry) => entry[1]);

  return (
    <WorkbenchContent
      key={extension.id}
      title={extension.name}
      description={extension.description}
      breadcrumb={breadcrumb}
      leading={<ExtensionIcon extension={extension} />}
      actions={headerActions}
      status={
        <>
          {isInstalling ? (
            <Spinner label="Installing" showLabel compact />
          ) : (
            <Badge variant={extension.isInstalled && extension.isEnabled ? "success" : "muted"}>
              {extension.isActive
                ? "Active"
                : extension.isInstalled
                  ? extension.isEnabled
                    ? "Installed"
                    : "Disabled"
                  : "Not installed"}
            </Badge>
          )}
          {hasUpdate ? <Badge variant="accent">Update available</Badge> : null}
        </>
      }
    >
      <div className="space-y-8">
        {extension.runtimeIssues?.length ? (
          <Alert tone="error">
            <AlertDescription>{extension.runtimeIssues[0]?.message}</AlertDescription>
          </Alert>
        ) : null}

        <ResourceContentSection title="Extension details">
          <Card variant="outline">
            <CardContent>
              <Table>
                <TableBody>
                  {metadata.map(([label, value]) => (
                    <TableRow key={label}>
                      <TableHead scope="row" className="w-1/3">
                        {label}
                      </TableHead>
                      <TableCell className="break-all">{value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </ResourceContentSection>

        {isAppearanceExtension(extension) && extension.appearanceOptions?.length ? (
          <ResourceContentSection title={extension.category === "theme" ? "Themes" : "Icon themes"}>
            <Card variant="outline">
              <CardContent>
                <ItemGroup>
                  {extension.appearanceOptions.map((option) => {
                    const isCurrent =
                      (extension.category === "theme"
                        ? appearanceSelection.theme
                        : appearanceSelection.iconTheme) === option.id;
                    return (
                      <Item key={option.id} role="listitem">
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
                            variant={isCurrent ? "default" : "accent"}
                            active={isCurrent}
                            disabled={!extension.isInstalled || isCurrent || isInstalling}
                            onClick={() => void actions.applyAppearance(extension, option.id)}
                          >
                            <CheckIcon />
                            {isCurrent
                              ? "Current"
                              : extension.isEnabled
                                ? "Use"
                                : "Activate and use"}
                          </Button>
                        </ItemActions>
                      </Item>
                    );
                  })}
                </ItemGroup>
              </CardContent>
            </Card>
          </ResourceContentSection>
        ) : null}

        {extension.category === "skill" ? (
          <ResourceContentSection title="Instructions">
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
                  <p className="text-subtle-foreground ui-text-sm">
                    Review what this skill asks the agent to do before adding it.
                  </p>
                  {skillPreview.isLoading ? (
                    <Card variant="muted">
                      <CardContent>
                        <Spinner label="Loading skill instructions" showLabel />
                      </CardContent>
                    </Card>
                  ) : skillPreview.error ? (
                    <Alert tone="error">
                      <AlertDescription>{skillPreview.error}</AlertDescription>
                    </Alert>
                  ) : skillContent ? (
                    <Card variant="muted">
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
          </ResourceContentSection>
        ) : null}

        <ResourceContentSection title="Contributions">
          <Card variant="outline">
            <CardContent>
              <ItemGroup>
                {(extension.contributionSummary?.length
                  ? extension.contributionSummary
                  : extension.extensions
                    ? extension.extensions
                    : [getCategoryLabel(extension.category)]
                ).map((item) => (
                  <Item key={item} role="listitem">
                    <ItemMedia variant="icon">
                      <CheckIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{item}</ItemTitle>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </CardContent>
          </Card>
        </ResourceContentSection>
      </div>
    </WorkbenchContent>
  );
}
