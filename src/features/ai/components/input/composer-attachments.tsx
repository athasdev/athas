import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useMemo, useState, type RefObject } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { Button } from "@/ui/button";
import {
  ChevronDownIcon,
  CodeBlockIcon,
  DatabaseIcon,
  FilesIcon,
  GitDiffIcon,
  GitPullRequestIcon,
  ImageIcon,
  StackIcon,
  TerminalWindowIcon,
  XIcon,
} from "@/ui/icons";
import { GithubMark } from "@/ui/brand-marks";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/ui/item";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/ui/popover";
import { instantTransition, quickTransition } from "@/utils/motion";
import {
  getComposerAttachmentGroups,
  type ComposerAttachmentEntry,
  type ComposerAttachmentKind,
  type ComposerAttachmentSource,
} from "../../utils/composer-attachment-groups";

const groupIcons = {
  files: FilesIcon,
  diffs: GitDiffIcon,
  images: ImageIcon,
  selections: CodeBlockIcon,
  terminals: TerminalWindowIcon,
  databases: DatabaseIcon,
  github: GithubMark,
  other: StackIcon,
};

type ComposerAttachmentsProps = Parameters<typeof getComposerAttachmentGroups>[0] & {
  onRemove: (source: ComposerAttachmentSource) => void;
  contextTriggerRef: RefObject<HTMLButtonElement | null>;
};

export function ComposerAttachments({
  onRemove,
  contextTriggerRef,
  ...selection
}: ComposerAttachmentsProps) {
  const { buffers, selectedBufferIds, selectedFilesPaths, selectedEditorContexts, pastedImages } =
    selection;
  const groups = useMemo(
    () =>
      getComposerAttachmentGroups({
        buffers,
        selectedBufferIds,
        selectedFilesPaths,
        selectedEditorContexts,
        pastedImages,
      }),
    [buffers, selectedBufferIds, selectedFilesPaths, selectedEditorContexts, pastedImages],
  );
  const [openGroup, setOpenGroup] = useState<ComposerAttachmentKind | null>(null);
  const reduceMotion = useReducedMotionConfig();
  const transition = reduceMotion ? instantTransition : quickTransition;

  const removeEntries = (
    entries: ComposerAttachmentEntry[],
    remaining: number,
    index = 0,
    list?: Element | null,
  ) => {
    if (remaining > 0) {
      const buttons = list?.querySelectorAll<HTMLButtonElement>("[data-remove-attachment]");
      (buttons?.[index + 1] ?? buttons?.[index - 1])?.focus();
    }
    for (const entry of entries) for (const source of entry.sources) onRemove(source);
    if (remaining === 0) {
      setOpenGroup(null);
      requestAnimationFrame(() => contextTriggerRef.current?.focus());
    }
  };

  if (groups.length === 0) return null;

  return (
    <div
      role="list"
      aria-label="Attached context"
      className="flex flex-wrap items-center gap-1 px-3 pt-2"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {groups.map((group) => {
          const Icon = groupIcons[group.kind];
          return (
            <motion.div
              key={group.kind}
              role="listitem"
              layout={reduceMotion ? false : "position"}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={transition}
            >
              <Popover
                open={openGroup === group.kind}
                onOpenChange={(open) => setOpenGroup(open ? group.kind : null)}
              >
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="group inline-flex h-6 items-center gap-1.5 rounded-md bg-transparent px-1.5 font-sans ui-text-sm text-muted-foreground outline-none transition-colors duration-fast hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/25 data-popup-open:bg-accent/60 data-popup-open:text-foreground motion-reduce:transition-none"
                    />
                  }
                  aria-label={`Review ${group.label}`}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <motion.span
                    key={group.items.length}
                    initial={reduceMotion ? false : { opacity: 0.5, y: -2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={transition}
                    className="text-foreground tabular-nums"
                  >
                    {group.items.length}
                  </motion.span>
                  <span>{group.noun}</span>
                  <ChevronDownIcon className="size-3 shrink-0 text-subtle-foreground transition-transform duration-fast group-data-popup-open:rotate-180 motion-reduce:transition-none" />
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-80 max-w-[calc(100vw-16px)]">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <PopoverHeader>
                      <PopoverTitle>{group.label}</PopoverTitle>
                    </PopoverHeader>
                    <Button
                      size="compact"
                      variant="ghost"
                      aria-label={`Remove ${group.label}`}
                      onClick={() => removeEntries(group.items, 0)}
                    >
                      Clear
                    </Button>
                  </div>
                  <ItemGroup
                    className="max-h-64 overflow-y-auto overscroll-contain"
                    aria-label={`Attached ${group.noun}`}
                  >
                    {group.items.map((item, index) => {
                      const ItemIcon =
                        item.bufferType === "pullRequest" ? GitPullRequestIcon : Icon;
                      return (
                        <Item key={item.key} role="listitem" size="compact" title={item.path}>
                          <ItemMedia variant={item.preview ? "image" : "icon"}>
                            {item.preview ? (
                              <img src={item.preview} alt={item.name} />
                            ) : item.kind === "files" ? (
                              <ThemedFileIcon fileName={item.name} isDir={false} />
                            ) : (
                              <ItemIcon />
                            )}
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle>{item.name}</ItemTitle>
                            <ItemDescription>{item.path}</ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <Button
                              data-remove-attachment
                              size="compact"
                              variant="ghost"
                              iconOnly
                              aria-label={`Remove ${item.name} from context`}
                              onClick={(event) =>
                                removeEntries(
                                  [item],
                                  group.items.length - 1,
                                  index,
                                  event.currentTarget.closest("[data-slot=item-group]"),
                                )
                              }
                            >
                              <XIcon />
                            </Button>
                          </ItemActions>
                        </Item>
                      );
                    })}
                  </ItemGroup>
                </PopoverContent>
              </Popover>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
