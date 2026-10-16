import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  applySkillDraft,
  createSkillFromMarketplace,
  loadMarketplaceSkills,
  resetSkillLocalOverride,
  resolveMarketplaceSkill,
  type SkillDraft,
  updateSkillFromMarketplace,
} from "@/features/ai/services/skill-library";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { showConfirmDialog } from "@/ui/dialog";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const currentSkills = () => useSettingsStore.getState().settings.aiSkills;

/** The skills in settings, the Athas skill catalog, and every change Customize makes to them. */
export function useSkillActions() {
  const skills = useSettingsStore((state) => state.settings.aiSkills);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const [catalog, setCatalog] = useState<MarketplaceSkill[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ draft: SkillDraft; isCatalogSkill: boolean } | null>(null);

  const reloadCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    try {
      setCatalog(await loadMarketplaceSkills());
    } finally {
      setIsLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  const saveSkills = useCallback(
    (next: AIChatSkill[]) => updateSetting("aiSkills", next),
    [updateSetting],
  );

  const install = useCallback(
    async (skill: MarketplaceSkill) => {
      setInstallingId(skill.id);
      try {
        const resolved = await resolveMarketplaceSkill(skill);
        await saveSkills([createSkillFromMarketplace(resolved), ...currentSkills()]);
        toast.success(`${skill.title} added`);
      } catch (error) {
        toast.error(`Couldn't add ${skill.title}`, { description: errorMessage(error) });
      } finally {
        setInstallingId(null);
      }
    },
    [saveSkills],
  );

  const update = useCallback(
    async (skill: AIChatSkill, marketplaceSkill: MarketplaceSkill) => {
      try {
        const updated = updateSkillFromMarketplace(
          skill,
          await resolveMarketplaceSkill(marketplaceSkill),
        );
        await saveSkills(currentSkills().map((item) => (item.id === skill.id ? updated : item)));
        toast.success(
          updated.localOverride
            ? `${skill.title} updated, your edits kept`
            : `${skill.title} updated`,
        );
      } catch (error) {
        toast.error(`Couldn't update ${skill.title}`, { description: errorMessage(error) });
      }
    },
    [saveSkills],
  );

  const resetOverride = useCallback(
    (skill: AIChatSkill) =>
      saveSkills(
        currentSkills().map((item) =>
          item.id === skill.id ? resetSkillLocalOverride(item) : item,
        ),
      ),
    [saveSkills],
  );

  const remove = useCallback(
    async (skill: AIChatSkill) => {
      const confirmed = await showConfirmDialog(`Delete ${skill.title}?`, {
        title: skill.source === "marketplace" ? "Remove skill" : "Delete skill",
        confirmLabel: skill.source === "marketplace" ? "Remove" : "Delete",
      });
      if (!confirmed) return;
      await saveSkills(currentSkills().filter((item) => item.id !== skill.id));
    },
    [saveSkills],
  );

  const save = useCallback(
    async (draft: SkillDraft) => {
      await saveSkills(applySkillDraft(currentSkills(), draft));
      setEditor(null);
    },
    [saveSkills],
  );

  return {
    skills,
    catalog,
    isLoadingCatalog,
    installingId,
    editor,
    reloadCatalog,
    install,
    update,
    resetOverride,
    remove,
    save,
    create: () => setEditor({ draft: { id: null, title: "", content: "" }, isCatalogSkill: false }),
    edit: (skill: AIChatSkill) =>
      setEditor({
        draft: { id: skill.id, title: skill.title, content: skill.content },
        isCatalogSkill: skill.source === "marketplace",
      }),
    closeEditor: () => setEditor(null),
  };
}
