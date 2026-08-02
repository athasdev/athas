import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  StrikeThroughSupSubToggles,
  applyListType$,
  convertSelectionToNode$,
  insertCodeBlock$,
  insertTable$,
  insertThematicBreak$,
  rootEditor$,
  useCellValue,
  usePublisher,
} from "@mdxeditor/editor";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  $createParagraphNode,
  type TextNode,
} from "lexical";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CommandEmpty, CommandItemRow, CommandList } from "@/ui/command";
import {
  ChatCircleTextIcon,
  CodeBlockIcon,
  ListBulletsIcon,
  ListChecksIcon,
  ListIcon,
  MinusIcon,
  TableIcon,
  TextTIcon,
} from "@/ui/icons";
import type {
  GitHubMarkdownCommandDefinition,
  GitHubMarkdownCommandGroup,
  GitHubMarkdownCommandId,
} from "../utils/github-markdown-commands";
import { filterGitHubMarkdownCommands } from "../utils/github-markdown-commands";

const COMMAND_GROUPS: GitHubMarkdownCommandGroup[] = ["basic blocks", "lists", "insert"];

class MarkdownSlashCommandOption extends MenuOption {
  definition: GitHubMarkdownCommandDefinition;
  run: () => void;

  constructor(definition: GitHubMarkdownCommandDefinition, run: () => void) {
    super(definition.id);
    this.definition = definition;
    this.run = run;
  }
}

function getCommandIcon(id: GitHubMarkdownCommandId): ReactNode {
  if (id === "paragraph") return <TextTIcon />;
  if (id.startsWith("heading-")) {
    return (
      <span className="github-markdown-command-heading-icon" aria-hidden="true">
        h{id.slice(-1)}
      </span>
    );
  }
  if (id === "quote") return <ChatCircleTextIcon />;
  if (id === "bullet-list") return <ListBulletsIcon />;
  if (id === "numbered-list") return <ListIcon />;
  if (id === "task-list") return <ListChecksIcon />;
  if (id === "code-block") return <CodeBlockIcon />;
  if (id === "divider") return <MinusIcon />;
  return <TableIcon />;
}

interface FloatingToolbarPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}

export function MarkdownFloatingToolbar() {
  const editor = useCellValue(rootEditor$);
  const [position, setPosition] = useState<FloatingToolbarPosition | null>(null);

  const updatePosition = useCallback(() => {
    if (!editor) {
      setPosition(null);
      return;
    }

    const root = editor.getRootElement();
    const nativeSelection = window.getSelection();
    const hasTextSelection = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return (
        $isRangeSelection(selection) &&
        !selection.isCollapsed() &&
        selection.getTextContent().trim().length > 0
      );
    });

    if (
      !root ||
      !hasTextSelection ||
      !nativeSelection ||
      nativeSelection.rangeCount === 0 ||
      !nativeSelection.anchorNode ||
      !nativeSelection.focusNode ||
      !root.contains(nativeSelection.anchorNode) ||
      !root.contains(nativeSelection.focusNode)
    ) {
      setPosition(null);
      return;
    }

    const range = nativeSelection.getRangeAt(0);
    const bounds = range.getBoundingClientRect();
    const rect = bounds.width || bounds.height ? bounds : range.getClientRects()[0];
    if (!rect) {
      setPosition(null);
      return;
    }

    const placement = rect.top > 52 ? "above" : "below";
    setPosition({
      left: Math.min(Math.max(rect.left + rect.width / 2, 96), window.innerWidth - 96),
      top: placement === "above" ? rect.top - 8 : rect.bottom + 8,
      placement,
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    let animationFrame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updatePosition);
    };
    const unregisterUpdate = editor.registerUpdateListener(scheduleUpdate);
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        scheduleUpdate();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    document.addEventListener("selectionchange", scheduleUpdate);
    document.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      unregisterUpdate();
      unregisterSelection();
      document.removeEventListener("selectionchange", scheduleUpdate);
      document.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [editor, updatePosition]);

  if (!position) return null;

  return createPortal(
    <div
      className="github-markdown-floating-toolbar"
      role="toolbar"
      aria-label="text formatting"
      data-placement={position.placement}
      style={{ left: position.left, top: position.top } as CSSProperties}
      onPointerDown={(event) => event.preventDefault()}
    >
      <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
      <StrikeThroughSupSubToggles options={["Strikethrough"]} />
      <CodeToggle />
      <CreateLink />
    </div>,
    document.body,
  );
}

export function MarkdownSlashCommands() {
  const [query, setQuery] = useState("");
  const convertSelectionToNode = usePublisher(convertSelectionToNode$);
  const applyListType = usePublisher(applyListType$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const insertTable = usePublisher(insertTable$);
  const insertThematicBreak = usePublisher(insertThematicBreak$);
  const triggerMatch = useBasicTypeaheadTriggerMatch("/", {
    minLength: 0,
    maxLength: 40,
  });

  const runCommand = useCallback(
    (id: GitHubMarkdownCommandId) => {
      if (id === "paragraph") convertSelectionToNode(() => $createParagraphNode());
      else if (id === "heading-1") convertSelectionToNode(() => $createHeadingNode("h1"));
      else if (id === "heading-2") convertSelectionToNode(() => $createHeadingNode("h2"));
      else if (id === "heading-3") convertSelectionToNode(() => $createHeadingNode("h3"));
      else if (id === "quote") convertSelectionToNode(() => $createQuoteNode());
      else if (id === "bullet-list") applyListType("bullet");
      else if (id === "numbered-list") applyListType("number");
      else if (id === "task-list") applyListType("check");
      else if (id === "code-block") insertCodeBlock({ language: "text" });
      else if (id === "divider") insertThematicBreak();
      else insertTable({ rows: 3, columns: 3 });
    },
    [convertSelectionToNode, applyListType, insertCodeBlock, insertTable, insertThematicBreak],
  );

  const options = useMemo(
    () =>
      filterGitHubMarkdownCommands(query).map(
        (definition) => new MarkdownSlashCommandOption(definition, () => runCommand(definition.id)),
      ),
    [query, runCommand],
  );

  const selectOption = useCallback(
    (
      option: MarkdownSlashCommandOption,
      textNodeContainingQuery: TextNode | null,
      closeMenu: () => void,
    ) => {
      const parent = textNodeContainingQuery?.getParent();
      textNodeContainingQuery?.remove();
      parent?.selectEnd();
      closeMenu();
      queueMicrotask(option.run);
    },
    [],
  );

  return (
    <LexicalTypeaheadMenuPlugin
      triggerFn={triggerMatch}
      onQueryChange={(nextQuery) => setQuery(nextQuery ?? "")}
      onSelectOption={selectOption}
      options={options}
      anchorClassName="github-markdown-slash-anchor"
      menuRenderFn={(anchorElementRef, menu) => {
        if (!anchorElementRef.current) return null;

        return createPortal(
          <div className="github-markdown-slash-menu" role="listbox" aria-label="block commands">
            <CommandList className="max-h-80" contentClassName="p-1.5">
              {menu.options.length === 0 ? (
                <CommandEmpty>no matching blocks</CommandEmpty>
              ) : (
                COMMAND_GROUPS.map((group) => {
                  const groupOptions = menu.options.filter(
                    (option) => option.definition.group === group,
                  );
                  if (groupOptions.length === 0) return null;

                  return (
                    <div key={group} className="github-markdown-slash-group">
                      <div className="github-markdown-slash-group-label">{group}</div>
                      {groupOptions.map((option) => {
                        const index = menu.options.indexOf(option);
                        const isSelected = menu.selectedIndex === index;

                        return (
                          <div
                            key={option.key}
                            ref={option.setRefElement}
                            id={`typeahead-item-${index}`}
                            role="option"
                            aria-selected={isSelected}
                          >
                            <CommandItemRow
                              icon={getCommandIcon(option.definition.id)}
                              title={option.definition.label}
                              density="compact"
                              isSelected={isSelected}
                              onMouseEnter={() => menu.setHighlightedIndex(index)}
                              onClick={() => menu.selectOptionAndCleanUp(option)}
                              accessory={isSelected ? "enter" : undefined}
                              className="github-markdown-slash-command"
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </CommandList>
          </div>,
          anchorElementRef.current,
        );
      }}
    />
  );
}
