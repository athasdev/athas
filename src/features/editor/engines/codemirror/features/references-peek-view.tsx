import { lineNumbers } from "@codemirror/view";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { FileCodeIcon, XIcon } from "@/ui/icons";
import { SidebarListItem } from "@/ui/sidebar";
import { useBufferStore } from "../../../stores/buffer.store";
import { getLanguageIdFromPath } from "../../../utils/language-id";
import { loadCodeMirrorLanguage } from "../languages";
import type { LspLocation } from "../navigation/code-lens";
import { fromLspPosition } from "../navigation/lsp-document";
import { groupReferenceLocations, type ReferenceEntry } from "../navigation/reference-groups";
import { athasEditorTheme, athasSyntaxHighlighting } from "../theme";

interface ReferencesPeekViewProps {
  locations: readonly LspLocation[];
  sourceFilePath: string;
  onOpen: (location: LspLocation) => void;
  onClose: () => void;
}

type FileContent = { status: "loading" } | { status: "ready"; text: string } | { status: "error" };

async function readPeekFile(filePath: string): Promise<string> {
  const buffer = useBufferStore
    .getState()
    .buffers.find((candidate) => candidate.type === "editor" && candidate.path === filePath);
  if (buffer && "content" in buffer && typeof buffer.content === "string") return buffer.content;
  return readFileContent(filePath);
}

function lineText(content: FileContent | undefined, line: number): string {
  if (content?.status !== "ready") return "";
  let start = 0;
  for (let current = 0; current < line; current++) {
    const next = content.text.indexOf("\n", start);
    if (next === -1) return "";
    start = next + 1;
  }
  const end = content.text.indexOf("\n", start);
  return content.text.slice(start, end === -1 ? undefined : end).replace(/\r$/, "");
}

/**
 * The references peek: every location grouped by file on the right, a read-only preview of the
 * selected one on the left. Arrow keys move through the list, Enter opens the location, Escape
 * closes the peek.
 */
export function ReferencesPeekView({
  locations,
  sourceFilePath,
  onOpen,
  onClose,
}: ReferencesPeekViewProps) {
  const { groups, entries } = useMemo(
    () => groupReferenceLocations(locations, sourceFilePath),
    [locations, sourceFilePath],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [contents, setContents] = useState<Record<string, FileContent>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const selected: ReferenceEntry | undefined = entries[selectedIndex];

  useEffect(() => {
    let cancelled = false;
    const paths = Array.from(new Set(entries.map((entry) => entry.filePath)));
    setContents(Object.fromEntries(paths.map((path) => [path, { status: "loading" }])));
    for (const path of paths) {
      void readPeekFile(path).then(
        (text) => {
          if (!cancelled)
            setContents((current) => ({ ...current, [path]: { status: "ready", text } }));
        },
        () => {
          if (!cancelled) setContents((current) => ({ ...current, [path]: { status: "error" } }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [entries]);

  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    rowRefs.current.get(selectedIndex)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = entries.length - 1;
    const move = (index: number) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex(Math.max(0, Math.min(last, index)));
    };
    switch (event.key) {
      case "ArrowDown":
        move(selectedIndex + 1);
        break;
      case "ArrowUp":
        move(selectedIndex - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(last);
        break;
      case "Enter":
        event.preventDefault();
        event.stopPropagation();
        if (selected) onOpen(selected.location);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
    }
  };

  const selectedGroup = groups.find((group) => group.filePath === selected?.filePath);

  return (
    <div
      className="flex h-full flex-col overflow-hidden border-border border-y bg-surface font-sans text-foreground ui-text-sm"
      data-slot="references-peek"
      onKeyDown={handleKeyDown}
    >
      <div className="flex h-7 shrink-0 items-center gap-2 px-2">
        <span className="truncate font-medium">{selectedGroup?.fileName ?? "References"}</span>
        {selectedGroup?.directory ? (
          <span className="min-w-0 truncate text-subtle-foreground">{selectedGroup.directory}</span>
        ) : null}
        <span className="ml-auto shrink-0 text-subtle-foreground tabular-nums">
          {entries.length === 1 ? "1 reference" : `${entries.length} references`}
        </span>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label="Close references peek"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {selected ? (
            <PeekPreview
              filePath={selected.filePath}
              content={contents[selected.filePath]}
              location={selected.location}
              onOpen={() => onOpen(selected.location)}
            />
          ) : null}
        </div>
        <div
          ref={listRef}
          role="listbox"
          aria-label="References"
          aria-activedescendant={selected ? `references-peek-${selectedIndex}` : undefined}
          tabIndex={0}
          className="w-72 shrink-0 overflow-y-auto border-border border-l py-1 outline-none"
        >
          {groups.map((group) => (
            <div key={group.filePath} role="group" aria-label={group.fileName}>
              <div className="flex items-center gap-1 px-2 py-0.5 text-muted-foreground">
                <FileCodeIcon />
                <span className="min-w-0 truncate">{group.fileName}</span>
                <span className="ml-auto shrink-0 tabular-nums">{group.entries.length}</span>
              </div>
              {group.entries.map((entry) => {
                const text = lineText(contents[entry.filePath], entry.location.range.start.line);
                return (
                  <SidebarListItem
                    key={entry.index}
                    as="div"
                    id={`references-peek-${entry.index}`}
                    role="option"
                    aria-selected={entry.index === selectedIndex}
                    density="compact"
                    active={entry.index === selectedIndex}
                    leading={
                      <span className="tabular-nums text-subtle-foreground">
                        {entry.location.range.start.line + 1}
                      </span>
                    }
                    ref={(element: HTMLElement | null) => {
                      if (element) rowRefs.current.set(entry.index, element);
                      else rowRefs.current.delete(entry.index);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSelectedIndex(entry.index);
                      listRef.current?.focus({ preventScroll: true });
                    }}
                    onDoubleClick={() => onOpen(entry.location)}
                  >
                    {text.trim() || `${entry.location.range.start.character + 1}`}
                  </SidebarListItem>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const setPreviewRange = StateEffect.define<{ from: number; to: number } | null>();
const previewRangeMark = Decoration.mark({ class: "cm-athas-match-current cm-athas-match" });
const previewLineMark = Decoration.line({ class: "cm-activeLine" });

const previewRangeField = StateField.define({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setPreviewRange)) continue;
      const range = effect.value;
      if (!range) return Decoration.none;
      const line = tr.state.doc.lineAt(range.from);
      return Decoration.set(
        [
          previewLineMark.range(line.from),
          ...(range.to > range.from ? [previewRangeMark.range(range.from, range.to)] : []),
        ],
        true,
      );
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function PeekPreview({
  filePath,
  content,
  location,
  onOpen,
}: {
  filePath: string;
  content: FileContent | undefined;
  location: LspLocation;
  onOpen: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const loadedRef = useRef<{ filePath: string; text: string } | null>(null);
  const language = useMemo(() => new Compartment(), []);
  const italicComments = useSettingsStore((state) => state.settings.editorItalicComments);
  const text = content?.status === "ready" ? content.text : null;

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: "" }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      loadedRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || text === null) return;
    const loaded = loadedRef.current;
    if (!loaded || loaded.filePath !== filePath || loaded.text !== text) {
      loadedRef.current = { filePath, text };
      view.setState(
        EditorState.create({
          doc: text,
          extensions: [
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            lineNumbers(),
            athasEditorTheme,
            athasSyntaxHighlighting(italicComments),
            language.of([]),
            previewRangeField,
          ],
        }),
      );
      void loadCodeMirrorLanguage(getLanguageIdFromPath(filePath)).then((support) => {
        if (viewRef.current !== view || loadedRef.current?.filePath !== filePath) return;
        view.dispatch({ effects: language.reconfigure(support ?? []) });
      });
    }
    const { doc } = view.state;
    const from = fromLspPosition(doc, location.range.start);
    const to = fromLspPosition(doc, location.range.end);
    view.dispatch({
      effects: [
        setPreviewRange.of({ from: Math.min(from, to), to: Math.max(from, to) }),
        EditorView.scrollIntoView(from, { y: "center" }),
      ],
    });
  }, [filePath, italicComments, language, location, text]);

  return (
    <>
      <div
        ref={hostRef}
        className="absolute inset-0"
        hidden={text === null}
        onDoubleClick={onOpen}
      />
      {content?.status === "loading" ? (
        <div className="px-3 py-2 text-subtle-foreground">Loading…</div>
      ) : content?.status === "error" ? (
        <div className="px-3 py-2 text-subtle-foreground">Could not read {filePath}</div>
      ) : null}
    </>
  );
}
