import { useEffect, useState } from "react";
import { listCodexComposerSkills } from "@/features/ai/integrations/codex/codex-composer-catalog";
import type { CodexSkillSummary } from "@/features/ai/integrations/codex/codex-types";
import {
  hasMarketplaceSkillUpdate,
  hasSkillLocalOverride,
} from "@/features/ai/services/skill-library";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import Badge from "@/ui/badge";
import { menuSeparator, type MenuItem } from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import { GroupedSection } from "@/ui/grouped-section";
import {
  ArrowCounterClockwiseIcon,
  ArrowUpIcon,
  MagicWandIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import type { useSkillActions } from "../hooks/use-skill-actions";
import {
  buildSkillCatalogRows,
  filterPersonalSkills,
  matchesCustomizeQuery,
} from "../services/customize-catalog";
import type { CustomizeTab } from "../types/customize.types";
import { CustomizeAddButton, CustomizeMoreMenu, CustomizeRow } from "./customize-row";

type SkillActions = ReturnType<typeof useSkillActions>;

export function skillMenuItems(
  skill: AIChatSkill,
  actions: SkillActions,
  marketplaceSkill?: MarketplaceSkill,
): MenuItem[] {
  const items: MenuItem[] = [
    { id: "edit", label: "Edit…", icon: <PencilIcon />, onClick: () => actions.edit(skill) },
  ];
  if (marketplaceSkill && hasMarketplaceSkillUpdate(skill, marketplaceSkill)) {
    items.push({
      id: "update",
      label: "Update",
      icon: <ArrowUpIcon />,
      onClick: () => void actions.update(skill, marketplaceSkill),
    });
  }
  if (hasSkillLocalOverride(skill)) {
    items.push({
      id: "reset",
      label: "Reset to catalog version",
      icon: <ArrowCounterClockwiseIcon />,
      onClick: () => void actions.resetOverride(skill),
    });
  }
  items.push(menuSeparator("remove-separator"), {
    id: "remove",
    label: skill.source === "marketplace" ? "Remove" : "Delete",
    icon: <TrashIcon />,
    tone: "destructive",
    onClick: () => void actions.remove(skill),
  });
  return items;
}

function skillPreview(skill: AIChatSkill) {
  return skill.description || skill.content.trim().replace(/\s+/g, " ") || "No instructions yet";
}

function useCodexSkills(enabled: boolean) {
  const cwd = useProjectStore((state) => state.rootFolderPath || ".");
  const [skills, setSkills] = useState<CodexSkillSummary[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let isCurrent = true;
    void listCodexComposerSkills(cwd)
      .then((result) => {
        if (isCurrent) setSkills(result.skills);
      })
      .catch(() => {
        if (isCurrent) setSkills([]);
      });
    return () => {
      isCurrent = false;
    };
  }, [cwd, enabled]);

  return enabled ? skills : [];
}

export function SkillsSection({
  tab,
  query,
  actions,
  codexInstalled,
  onShowCatalog,
}: {
  tab: CustomizeTab;
  query: string;
  actions: SkillActions;
  codexInstalled: boolean;
  onShowCatalog: () => void;
}) {
  const codexSkills = useCodexSkills(tab === "installed" && codexInstalled).filter((skill) =>
    matchesCustomizeQuery(query, skill.name, skill.description),
  );

  if (tab === "catalog") {
    if (actions.isLoadingCatalog && actions.catalog.length === 0) {
      return (
        <EmptyState
          className="min-h-64"
          message={<Spinner label="Loading skills" showLabel compact />}
        />
      );
    }
    const rows = buildSkillCatalogRows(actions.catalog, actions.skills, query);
    if (rows.length === 0) {
      return (
        <EmptyState
          className="min-h-64"
          icon={<MagicWandIcon />}
          title={actions.catalog.length === 0 ? "No published skills yet" : "No skills match"}
          action={{ label: "Write a skill", icon: <PlusIcon />, onClick: () => actions.create() }}
        />
      );
    }
    return (
      <GroupedSection title="Athas catalog" variant="grid">
        {rows.map(({ skill, installed }) => (
          <CustomizeRow
            key={skill.id}
            title={skill.title}
            description={skill.description}
            status={
              installed && hasMarketplaceSkillUpdate(installed, skill) ? (
                <Badge tone="accent">Update</Badge>
              ) : null
            }
            action={
              installed ? (
                <CustomizeMoreMenu
                  label={`${skill.title} actions`}
                  items={skillMenuItems(installed, actions, skill)}
                />
              ) : (
                <CustomizeAddButton
                  label={`Add ${skill.title}`}
                  busy={actions.installingId === skill.id}
                  busyLabel="Adding"
                  onClick={() => void actions.install(skill)}
                />
              )
            }
          />
        ))}
      </GroupedSection>
    );
  }

  const personal = filterPersonalSkills(actions.skills, query);
  if (personal.length === 0 && codexSkills.length === 0) {
    return (
      <EmptyState
        className="min-h-64"
        icon={<MagicWandIcon />}
        title={actions.skills.length === 0 ? "No skills yet" : "No skills match"}
        message={
          actions.skills.length === 0
            ? "Skills are instructions you can hand to any agent from the composer."
            : undefined
        }
        action={{ label: "Write a skill", icon: <PlusIcon />, onClick: () => actions.create() }}
        secondaryAction={{ label: "Browse the catalog", variant: "ghost", onClick: onShowCatalog }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {personal.length > 0 ? (
        <GroupedSection title="Your skills" variant="grid">
          {personal.map((skill) => {
            const marketplaceSkill = actions.catalog.find(
              (candidate) => candidate.id === (skill.sourceId || skill.id),
            );
            return (
              <CustomizeRow
                key={skill.id}
                title={skill.title}
                description={skillPreview(skill)}
                status={hasSkillLocalOverride(skill) ? <Badge>Edited</Badge> : null}
                action={
                  <CustomizeMoreMenu
                    label={`${skill.title} actions`}
                    items={skillMenuItems(skill, actions, marketplaceSkill)}
                  />
                }
              />
            );
          })}
        </GroupedSection>
      ) : null}
      {codexSkills.length > 0 ? (
        <GroupedSection
          title="Codex"
          description="Skills Codex loads from its own folders"
          variant="grid"
        >
          {codexSkills.map((skill) => (
            <CustomizeRow
              key={skill.path || skill.name}
              title={skill.name}
              description={skill.description || skill.path}
              brand={{ kind: "provider", providerId: "codex" }}
              status={skill.enabled ? null : <Badge>Off</Badge>}
            />
          ))}
        </GroupedSection>
      ) : null}
    </div>
  );
}
