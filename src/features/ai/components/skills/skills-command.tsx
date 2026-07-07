import {
  CloudArrowDownIcon as CloudArrowDown,
  CloudCheckIcon as CloudCheck,
  CloudSlashIcon as CloudSlash,
  CloudWarningIcon as CloudWarning,
  MagnifyingGlassIcon as Search,
  PencilSimpleIcon as PencilSimple,
  PlusIcon as Plus,
  TrashIcon as Trash,
} from "@phosphor-icons/react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  createSkillFromMarketplace,
  hasSkillLocalOverride,
  isMarketplaceSkillInstalled,
  loadMarketplaceSkills,
} from "@/features/ai/lib/skill-library";
import { fuzzyScore } from "@/features/global-search/utils/fuzzy-search";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useSettingsSyncStore } from "@/features/settings/stores/settings-sync.store";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";

interface SkillsCommandProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSkill: (skill: AIChatSkill) => void;
  initialView?: SkillsView;
}

type SkillsView = "list" | "browse" | "editor";

function createSkillId() {
  return `skill-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getSyncLabel(enabled: boolean, status: string) {
  if (!enabled) return "Not synced";
  if (status === "syncing") return "Syncing";
  if (status === "error") return "Sync paused";
  return "Synced";
}

function getSyncIcon(enabled: boolean, status: string) {
  if (!enabled) return CloudSlash;
  if (status === "error") return CloudWarning;
  return CloudCheck;
}

export function SkillsCommand({
  isOpen,
  onClose,
  onSelectSkill,
  initialView = "list",
}: SkillsCommandProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<SkillsView>("list");
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [isLoadingMarketplace, setIsLoadingMarketplace] = useState(false);

  const skills = useSettingsStore((state) => state.settings.aiSkills);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const syncEnabled = useSettingsSyncStore((state) => state.enabled);
  const syncStatus = useSettingsSyncStore((state) => state.status);
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);

  const filteredSkills = useMemo(() => {
    const normalizedQuery = deferredQuery.trim();
    const sortedSkills = [...skills].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );

    if (!normalizedQuery) {
      return sortedSkills;
    }

    return sortedSkills
      .map((skill) => ({
        skill,
        score:
          fuzzyScore(skill.title, normalizedQuery) * 2 + fuzzyScore(skill.content, normalizedQuery),
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((result) => result.skill);
  }, [deferredQuery, skills]);

  const filteredMarketplaceSkills = useMemo(() => {
    const normalizedQuery = deferredQuery.trim();
    const sortedSkills = [...marketplaceSkills].sort((a, b) => a.title.localeCompare(b.title));

    if (!normalizedQuery) {
      return sortedSkills;
    }

    return sortedSkills
      .map((skill) => ({
        skill,
        score:
          fuzzyScore(skill.title, normalizedQuery) * 2 +
          fuzzyScore(skill.description, normalizedQuery) +
          fuzzyScore(skill.tags.join(" "), normalizedQuery),
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((result) => result.skill);
  }, [deferredQuery, marketplaceSkills]);

  const resetEditor = useCallback(() => {
    setEditingSkillId(null);
    setTitle("");
    setContent("");
  }, []);

  const openNewSkill = useCallback(() => {
    resetEditor();
    setView("editor");
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, [resetEditor]);

  const openBrowseSkills = useCallback(() => {
    setView("browse");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const openSkillEditor = useCallback((skill: AIChatSkill) => {
    setEditingSkillId(skill.id);
    setTitle(skill.title);
    setContent(skill.content);
    setView("editor");
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, []);

  const closeEditor = useCallback(() => {
    resetEditor();
    setView("list");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [resetEditor]);

  const handleClose = useCallback(() => {
    setView("list");
    resetEditor();
    onClose();
  }, [onClose, resetEditor]);

  const openAccountSyncSettings = useCallback(() => {
    handleClose();
    openSettingsDialog("account");
  }, [handleClose, openSettingsDialog]);

  const handleInstallMarketplaceSkill = useCallback(
    async (skill: MarketplaceSkill) => {
      if (isMarketplaceSkillInstalled(skills, skill.id)) return;
      await updateSetting("aiSkills", [createSkillFromMarketplace(skill), ...skills]);
    },
    [skills, updateSetting],
  );

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const now = new Date().toISOString();
    const nextSkills = editingSkillId
      ? skills.map((skill) =>
          skill.id === editingSkillId
            ? (() => {
                if (skill.source !== "marketplace") {
                  return { ...skill, title: trimmedTitle, content, updatedAt: now };
                }

                const upstreamTitle = skill.upstreamTitle ?? skill.title;
                const upstreamContent = skill.upstreamContent ?? skill.content;
                const upstreamDescription = skill.upstreamDescription ?? skill.description;

                return {
                  ...skill,
                  title: trimmedTitle,
                  content,
                  localOverride: trimmedTitle !== upstreamTitle || content !== upstreamContent,
                  upstreamTitle,
                  upstreamContent,
                  upstreamDescription,
                  updatedAt: now,
                };
              })()
            : skill,
        )
      : [
          {
            id: createSkillId(),
            title: trimmedTitle,
            content,
            source: "local" as const,
            createdAt: now,
            updatedAt: now,
          },
          ...skills,
        ];

    await updateSetting("aiSkills", nextSkills);
    closeEditor();
  }, [closeEditor, content, editingSkillId, skills, title, updateSetting]);

  const handleDelete = useCallback(
    async (skillId: string) => {
      await updateSetting(
        "aiSkills",
        skills.filter((skill) => skill.id !== skillId),
      );
      setSelectedIndex(0);
    },
    [skills, updateSetting],
  );

  const handleSelectSkill = useCallback(
    (skill: AIChatSkill) => {
      onSelectSkill(skill);
      handleClose();
    },
    [handleClose, onSelectSkill],
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelectedIndex(0);
    resetEditor();
    setView(initialView);
    requestAnimationFrame(() => {
      if (initialView === "editor") {
        titleInputRef.current?.focus();
        return;
      }
      inputRef.current?.focus();
    });
  }, [initialView, isOpen, resetEditor]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [deferredQuery, view]);

  useEffect(() => {
    if (!isOpen || (view !== "list" && view !== "browse")) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeItems = view === "browse" ? filteredMarketplaceSkills : filteredSkills;

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          handleClose();
          break;
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((current) =>
            activeItems.length === 0 ? 0 : Math.min(current + 1, activeItems.length - 1),
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((current) => Math.max(current - 1, 0));
          break;
        case "Enter":
          if (view === "list" && filteredSkills[selectedIndex]) {
            event.preventDefault();
            handleSelectSkill(filteredSkills[selectedIndex]);
          } else if (view === "browse" && filteredMarketplaceSkills[selectedIndex]) {
            event.preventDefault();
            void handleInstallMarketplaceSkill(filteredMarketplaceSkills[selectedIndex]);
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    filteredMarketplaceSkills,
    filteredSkills,
    handleClose,
    handleInstallMarketplaceSkill,
    handleSelectSkill,
    isOpen,
    selectedIndex,
    view,
  ]);

  useEffect(() => {
    if (!isOpen || view !== "browse" || marketplaceSkills.length > 0 || isLoadingMarketplace) {
      return;
    }

    setIsLoadingMarketplace(true);
    void loadMarketplaceSkills()
      .then(setMarketplaceSkills)
      .finally(() => setIsLoadingMarketplace(false));
  }, [isLoadingMarketplace, isOpen, marketplaceSkills.length, view]);

  useEffect(() => {
    const activeLength =
      view === "browse" ? filteredMarketplaceSkills.length : filteredSkills.length;
    if (!resultsRef.current || activeLength === 0) return;
    const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement | undefined;
    selectedElement?.scrollIntoView({ block: "nearest" });
  }, [filteredMarketplaceSkills.length, filteredSkills.length, selectedIndex, view]);

  const canSave = title.trim().length > 0;
  const SyncIcon = getSyncIcon(syncEnabled, syncStatus);

  return (
    <Command isVisible={isOpen} onClose={handleClose}>
      {view === "list" || view === "browse" ? (
        <>
          <CommandHeader onClose={handleClose}>
            <Search className="shrink-0 text-text-lighter" size={14} />
            <CommandInput
              ref={inputRef}
              value={query}
              onChange={setQuery}
              placeholder={view === "browse" ? "Search available skills..." : "Search skills..."}
            />
            {view === "list" ? (
              <CommandHeaderAction type="button" onClick={openNewSkill}>
                <Plus />
                <span>New</span>
              </CommandHeaderAction>
            ) : (
              <CommandHeaderAction type="button" onClick={() => setView("list")}>
                <span>My skills</span>
              </CommandHeaderAction>
            )}
            <CommandHeaderAction
              type="button"
              onClick={openBrowseSkills}
              active={view === "browse"}
            >
              <CloudArrowDown weight="fill" />
              <span>Browse</span>
            </CommandHeaderAction>
          </CommandHeader>

          <CommandList ref={resultsRef}>
            {view === "browse" ? (
              isLoadingMarketplace ? (
                <CommandEmpty>Loading available skills...</CommandEmpty>
              ) : marketplaceSkills.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <CommandEmpty>No published skills yet</CommandEmpty>
                  <div className="ui-text-base max-w-[280px] text-text-lighter">
                    Published skills will appear here once the Athas skills registry is available.
                  </div>
                </div>
              ) : filteredMarketplaceSkills.length === 0 ? (
                <CommandEmpty>No available skills match "{query}"</CommandEmpty>
              ) : (
                filteredMarketplaceSkills.map((skill, index) => {
                  const isSelected = selectedIndex === index;
                  const isInstalled = isMarketplaceSkillInstalled(skills, skill.id);

                  return (
                    <CommandItemRow
                      key={skill.id}
                      as="div"
                      isSelected={isSelected}
                      onClick={() =>
                        isInstalled ? undefined : void handleInstallMarketplaceSkill(skill)
                      }
                      onMouseEnter={() => setSelectedIndex(index)}
                      className="group"
                      title={skill.title}
                      description={
                        <>
                          <span>{skill.description}</span>
                          {skill.author ? <span>by {skill.author}</span> : null}
                        </>
                      }
                      contentLayout="stacked"
                      accessory={
                        <>
                          {skill.version ? (
                            <CommandItemBadge>v{skill.version}</CommandItemBadge>
                          ) : null}
                          {skill.tags.slice(0, 3).map((tag) => (
                            <CommandItemBadge key={tag}>{tag}</CommandItemBadge>
                          ))}
                        </>
                      }
                      action={
                        <Button
                          type="button"
                          variant={isInstalled ? "default" : "default"}
                          disabled={isInstalled}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!isInstalled) {
                              void handleInstallMarketplaceSkill(skill);
                            }
                          }}
                        >
                          {isInstalled ? "Added" : "Add"}
                        </Button>
                      }
                    />
                  );
                })
              )
            ) : skills.length === 0 ? (
              <CommandEmpty>No skills yet</CommandEmpty>
            ) : filteredSkills.length === 0 ? (
              <CommandEmpty>No skills match "{query}"</CommandEmpty>
            ) : (
              filteredSkills.map((skill, index) => {
                const isSelected = selectedIndex === index;
                const preview = skill.content.trim().replace(/\s+/g, " ");
                const hasLocalOverride = hasSkillLocalOverride(skill);

                return (
                  <CommandItemRow
                    key={skill.id}
                    as="div"
                    isSelected={isSelected}
                    onClick={() => handleSelectSkill(skill)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className="group"
                    title={skill.title}
                    description={preview}
                    contentLayout="stacked"
                    accessory={
                      <>
                        {skill.source === "marketplace" ? (
                          <CommandItemBadge>Marketplace</CommandItemBadge>
                        ) : null}
                        {hasLocalOverride ? (
                          <CommandItemBadge>Local override</CommandItemBadge>
                        ) : null}
                      </>
                    }
                    action={
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            openSkillEditor(skill);
                          }}
                          className="opacity-0 focus:opacity-100 group-hover:opacity-100"
                          tooltip="Edit skill"
                          aria-label={`Edit ${skill.title}`}
                        >
                          <PencilSimple size={13} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(skill.id);
                          }}
                          className="opacity-0 hover:bg-error/10 hover:text-error focus:opacity-100 group-hover:opacity-100"
                          tooltip="Delete skill"
                          aria-label={`Delete ${skill.title}`}
                        >
                          <Trash size={13} />
                        </Button>
                      </>
                    }
                  />
                );
              })
            )}
          </CommandList>

          <CommandFooter>
            <CommandFooterAction type="button" onClick={openAccountSyncSettings}>
              <SyncIcon />
              <span className="truncate">{getSyncLabel(syncEnabled, syncStatus)}</span>
            </CommandFooterAction>
          </CommandFooter>
        </>
      ) : (
        <>
          <CommandHeader onClose={handleClose}>
            <div className="min-w-0 flex-1">
              <div className="ui-font ui-text-base truncate text-text">
                {editingSkillId ? "Edit skill" : "New skill"}
              </div>
              {(() => {
                const editingSkill = skills.find((skill) => skill.id === editingSkillId);
                if (!editingSkill || editingSkill.source !== "marketplace") return null;

                return (
                  <div className="ui-text-base mt-0.5 text-text-lighter">
                    Marketplace skill
                    {hasSkillLocalOverride(editingSkill) ? " with local override" : ""}
                  </div>
                );
              })()}
            </div>
          </CommandHeader>

          <div className="custom-scrollbar-thin flex-1 space-y-3 overflow-y-auto p-3">
            <div className="space-y-1.5">
              <label className="ui-font ui-text-base text-text-lighter" htmlFor="ai-skill-title">
                Title
              </label>
              <Input
                id="ai-skill-title"
                ref={titleInputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Code review checklist"
                maxLength={120}
                size="sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="ui-font ui-text-base text-text-lighter" htmlFor="ai-skill-content">
                Markdown
              </label>
              <Textarea
                id="ai-skill-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Write the instructions or reusable context for this skill..."
                className="min-h-36 resize-none"
                size="sm"
              />
            </div>
          </div>

          <CommandFooter>
            <CommandFooterAction type="button" onClick={closeEditor}>
              Cancel
            </CommandFooterAction>
            <CommandFooterAction
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
            >
              Save
            </CommandFooterAction>
          </CommandFooter>
        </>
      )}
    </Command>
  );
}
