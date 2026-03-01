import "../styles/overlay-editor.css";
import { CornerDownLeft, X } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { useAIChatStore } from "@/features/ai/store/store";
import { useGitGutter } from "@/features/git/hooks/use-gutter";
import { useSettingsStore } from "@/features/settings/store";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useAuthStore } from "@/stores/auth-store";
import { useInlineEditToolbarStore } from "@/stores/inline-edit-toolbar-store";
import { toast } from "@/stores/toast-store";
import { useZoomStore } from "@/stores/zoom-store";
import { type AutocompleteModel, fetchAutocompleteModels } from "@/utils/autocomplete";
import { InlineEditError, requestInlineEdit } from "@/utils/inline-edit";
import { EDITOR_CONSTANTS } from "../config/constants";
import EditorContextMenu from "../context-menu/context-menu";
import { editorAPI } from "../extensions/api";
import { useAutocomplete } from "../hooks/use-autocomplete";
import { useContextMenu } from "../hooks/use-context-menu";
import { useEditorOperations } from "../hooks/use-editor-operations";
import { useFoldTransform } from "../hooks/use-fold-transform";
import { useInlineDiff } from "../hooks/use-inline-diff";
import { usePerformanceMonitor } from "../hooks/use-performance";
import { useResolvedEditorSettings } from "../hooks/use-resolved-settings";
import { getLanguageId, useTokenizer } from "../hooks/use-tokenizer";
import { useViewportLines } from "../hooks/use-viewport-lines";
import { useLspStore } from "../lsp/lsp-store";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorDecorationsStore } from "../stores/decorations-store";
import { useFoldStore } from "../stores/fold-store";
import { useMinimapStore } from "../stores/minimap-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorUIStore } from "../stores/ui-store";
import type { Decoration, Position, Range } from "../types/editor";
import { applyVirtualEdit, calculateActualOffset } from "../utils/fold-transformer";
import { calculateLineHeight, calculateLineOffset, splitLines } from "../utils/lines";
import { applyMultiCursorBackspace, applyMultiCursorEdit } from "../utils/multi-cursor";
import { calculateCursorPosition, getAccurateCursorX } from "../utils/position";
import { scrollLogger } from "../utils/scroll-logger";
import { InlineDiff } from "./diff/inline-diff";
import { Gutter } from "./gutter/gutter";
import { InlineEditModelSelector } from "./inline-edit-model-selector";
import { DefinitionLinkLayer } from "./layers/definition-link-layer";
import { GitBlameLayer } from "./layers/git-blame-layer";
import { HighlightLayer } from "./layers/highlight-layer";
import { InputLayer } from "./layers/input-layer";
import { MultiCursorLayer } from "./layers/multi-cursor-layer";
import { SearchHighlightLayer } from "./layers/search-highlight-layer";
import { SelectionLayer } from "./layers/selection-layer";
import { VimCursorLayer } from "./layers/vim-cursor-layer";
import { Minimap } from "./minimap/minimap";

interface EditorProps {
  className?: string;
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
  onMouseEnter?: () => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const LARGE_FILE_SCROLL_OPTIMIZATION_THRESHOLD = 20000;
const LARGE_FILE_SCROLL_TOKENIZE_DEBOUNCE_MS = 120;
const SCROLL_STATE_UPDATE_INTERVAL_MS = 33;
const AUTO_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};
const AUTO_PAIR_CLOSERS = new Set(Object.values(AUTO_PAIRS));
const BLOCK_COMMENT_LANGUAGES = new Set(["css"]);
const DEFAULT_INLINE_EDIT_INSTRUCTION = "Improve this code while preserving behavior.";
const DEFAULT_INLINE_EDIT_MODELS: AutocompleteModel[] = [
  { id: "openai/gpt-5-nano", name: "GPT-5 Nano" },
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini" },
  { id: "openai/gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
  { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
];
const INLINE_EDIT_POPOVER_WIDTH = 320;
const INLINE_EDIT_POPOVER_ESTIMATED_HEIGHT = 170;
const INLINE_EDIT_POPOVER_MARGIN = 8;
const INLINE_EDIT_POPOVER_X_OFFSET = 10;
const INLINE_EDIT_POPOVER_Y_OFFSET = 10;
const INLINE_EDIT_TOP_THRESHOLD = 64;

function isAltGraphPressed(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.getModifierState("AltGraph") || (e.ctrlKey && e.altKey && !e.metaKey);
}

export function Editor({
  className,
  onMouseMove,
  onMouseLeave,
  onMouseEnter,
  onClick,
}: EditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const multiCursorRef = useRef<HTMLDivElement>(null);
  const searchHighlightRef = useRef<HTMLDivElement>(null);
  const selectionLayerRef = useRef<HTMLDivElement>(null);
  const vimCursorRef = useRef<HTMLDivElement>(null);
  const autocompleteCompletionRef = useRef<HTMLDivElement>(null);
  const inlineEditOverlayRef = useRef<HTMLDivElement>(null);
  const inlineEditPopoverRef = useRef<HTMLDivElement>(null);
  const inlineEditInstructionRef = useRef<HTMLInputElement>(null);

  // Track scroll position for minimap
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [editorViewportHeight, setEditorViewportHeight] = useState(0);

  // Track buffer changes to handle cursor positioning correctly
  const prevBufferIdRef = useRef<string | null>(null);
  const isBufferSwitchRef = useRef(false);

  const bufferId = useBufferStore.use.activeBufferId();
  const buffers = useBufferStore.use.buffers();
  const { updateBufferContent } = useBufferStore.use.actions();
  const {
    setCursorPosition,
    setSelection,
    enableMultiCursor,
    addCursor,
    clearSecondaryCursors,
    updateCursor,
  } = useEditorStateStore.use.actions();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const selection = useEditorStateStore.use.selection?.();
  const multiCursorState = useEditorStateStore.use.multiCursorState();
  const onChange = useEditorStateStore.use.onChange();
  const inlineEditVisible = useInlineEditToolbarStore.use.isVisible();
  const inlineEditToolbarActions = useInlineEditToolbarStore.use.actions();

  const baseFontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const vimModeEnabled = useSettingsStore((state) => state.settings.vimMode);
  const aiCompletionEnabled = useSettingsStore((state) => state.settings.aiCompletion);
  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const hasOpenRouterKey = useAIChatStore(
    (state) => state.providerApiKeys.get("openrouter") || false,
  );
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);
  const vimMode = useVimStore.use.mode();
  const [inlineEditInstruction, setInlineEditInstruction] = useState("");
  const [isInlineEditRunning, setIsInlineEditRunning] = useState(false);
  const [isInlineEditModelLoading, setIsInlineEditModelLoading] = useState(false);
  const [inlineEditModels, setInlineEditModels] = useState<AutocompleteModel[]>(
    DEFAULT_INLINE_EDIT_MODELS,
  );
  const [inlineEditSelectionAnchor, setInlineEditSelectionAnchor] = useState<{
    line: number;
    column: number;
  } | null>(null);

  useOnClickOutside(inlineEditPopoverRef as RefObject<HTMLElement>, () => {
    if (!inlineEditVisible) return;
    inlineEditToolbarActions.hide();
  });

  useEffect(() => {
    if (!inlineEditVisible) return;
    setInlineEditInstruction("");
    requestAnimationFrame(() => {
      inlineEditInstructionRef.current?.focus();
      inlineEditInstructionRef.current?.select();
    });
  }, [inlineEditVisible]);

  useEffect(() => {
    if (!inlineEditVisible) return;

    const loadModels = async () => {
      setIsInlineEditModelLoading(true);
      try {
        const models = await fetchAutocompleteModels();
        if (models.length > 0) {
          setInlineEditModels(models);
          if (!models.some((model) => model.id === aiAutocompleteModelId)) {
            await updateSetting("aiAutocompleteModelId", models[0].id);
          }
        } else {
          setInlineEditModels(DEFAULT_INLINE_EDIT_MODELS);
        }
      } catch {
        setInlineEditModels(DEFAULT_INLINE_EDIT_MODELS);
      } finally {
        setIsInlineEditModelLoading(false);
      }
    };

    void checkAllProviderApiKeys();
    void loadModels();
  }, [inlineEditVisible, aiAutocompleteModelId, updateSetting, checkAllProviderApiKeys]);

  useEffect(() => {
    const hasSelection = Boolean(selection && selection.start.offset !== selection.end.offset);
    if (hasSelection) return;
    setInlineEditSelectionAnchor(null);
    if (inlineEditVisible) {
      inlineEditToolbarActions.hide();
    }
  }, [selection, inlineEditVisible, inlineEditToolbarActions]);

  // Apply zoom by scaling font size instead of CSS transform
  // This ensures text and positioned elements use the same rendering path
  const fontSize = baseFontSize * zoomLevel;
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();

  const buffer = buffers.find((b) => b.id === bufferId);
  const content = buffer?.content || "";
  const filePath = buffer?.path;

  const resolvedSettings = useResolvedEditorSettings(filePath ?? null);
  const tabSize = resolvedSettings.tabSize;

  useGitGutter({
    filePath: filePath || "",
    content,
    enabled: !!filePath,
  });

  const foldActions = useFoldStore.use.actions();

  // Minimap state
  const minimapEnabled = useSettingsStore((state) => state.settings.showMinimap);
  const minimapScale = useMinimapStore.use.scale();
  const minimapWidth = useMinimapStore.use.width();

  useEffect(() => {
    if (filePath && content) {
      foldActions.computeFoldRegions(filePath, content);
    }
  }, [filePath, content, foldActions]);

  const foldTransform = useFoldTransform(filePath, content);

  const hasSyntaxHighlighting = useMemo(() => {
    if (!filePath) return false;
    return getLanguageId(filePath) !== null;
  }, [filePath]);

  const contextMenu = useContextMenu();
  const inlineDiff = useInlineDiff(filePath, content);

  const { startMeasure, endMeasure } = usePerformanceMonitor("Editor");

  const actualLines = useMemo(() => {
    startMeasure(`splitLines (len: ${content.length})`);
    const res = splitLines(content);
    endMeasure(`splitLines (len: ${content.length})`);
    return res;
  }, [content, startMeasure, endMeasure]);
  const lines = foldTransform.hasActiveFolds ? foldTransform.virtualLines : actualLines;
  const displayContent = foldTransform.hasActiveFolds ? foldTransform.virtualContent : content;

  useEffect(() => {
    if (!inlineEditVisible || inlineEditSelectionAnchor || !inputRef.current) return;
    const start = inputRef.current.selectionStart;
    const end = inputRef.current.selectionEnd;
    if (start === end) return;
    const anchorPos = calculateCursorPosition(Math.max(start, end), lines);
    setInlineEditSelectionAnchor({ line: anchorPos.line, column: anchorPos.column });
  }, [inlineEditVisible, inlineEditSelectionAnchor, lines]);
  // Use consistent line height for both textarea and gutter
  // This ensures they stay synchronized at all zoom levels
  const lineHeight = useMemo(() => calculateLineHeight(fontSize), [fontSize]);
  const shouldVirtualizeRendering =
    lines.length >= EDITOR_CONSTANTS.RENDER_VIRTUALIZATION_THRESHOLD;

  const {
    viewportRange,
    handleScroll: handleViewportScroll,
    initializeViewport,
  } = useViewportLines({
    lineHeight,
  });

  const { tokens, tokenizedContent, tokenize, forceFullTokenize } = useTokenizer({
    filePath,
    bufferId: bufferId || undefined,
    incremental: true,
    enabled: hasSyntaxHighlighting,
  });

  // Listen for extension installation to re-trigger tokenization
  useEffect(() => {
    const handleExtensionInstalled = (event: Event) => {
      const customEvent = event as CustomEvent<{ extensionId: string; filePath: string }>;
      if (customEvent.detail.filePath === filePath && content) {
        forceFullTokenize(content);
      }
    };

    window.addEventListener("extension-installed", handleExtensionInstalled);
    return () => {
      window.removeEventListener("extension-installed", handleExtensionInstalled);
    };
  }, [filePath, content, forceFullTokenize]);

  const visualCursorLine = useMemo(() => {
    if (foldTransform.hasActiveFolds) {
      return foldTransform.mapping.actualToVirtual.get(cursorPosition.line) ?? cursorPosition.line;
    }
    return cursorPosition.line;
  }, [cursorPosition.line, foldTransform]);

  const handleInput = useCallback(
    (newVirtualContent: string) => {
      if (!bufferId || !inputRef.current) return;

      // Any actual typing/edit should dismiss hover info immediately.
      const uiActions = useEditorUIStore.getState().actions;
      uiActions.setHoverInfo(null);
      uiActions.setIsHovering(false);
      uiActions.setAutocompleteCompletion(null);

      let newActualContent: string;
      if (foldTransform.hasActiveFolds) {
        newActualContent = applyVirtualEdit(content, newVirtualContent, foldTransform.mapping);
      } else {
        newActualContent = newVirtualContent;
      }

      updateBufferContent(bufferId, newActualContent);
      onChange(newActualContent);

      const selectionStart = inputRef.current.selectionStart;
      const virtualLines = splitLines(newVirtualContent);
      const position = calculateCursorPosition(selectionStart, virtualLines);

      if (foldTransform.hasActiveFolds) {
        const actualLine =
          foldTransform.mapping.virtualToActual.get(position.line) ?? position.line;
        const actualOffset = calculateActualOffset(
          splitLines(newActualContent),
          actualLine,
          position.column,
        );
        setCursorPosition({
          line: actualLine,
          column: position.column,
          offset: actualOffset,
        });
      } else {
        setCursorPosition(position);
      }

      // Signal that user typed something (for completion triggering)
      const timestamp = Date.now();
      console.log("handleInput: setting lastInputTimestamp", timestamp);
      useEditorUIStore.getState().actions.setLastInputTimestamp(timestamp);
    },
    [bufferId, updateBufferContent, setCursorPosition, content, foldTransform, onChange],
  );

  const editorOps = useEditorOperations({
    inputRef,
    content,
    bufferId,
    updateBufferContent,
    handleInput,
  });

  const handleCursorChange = useCallback(() => {
    if (!bufferId || !inputRef.current) return;

    // Skip cursor updates during buffer switches to prevent dragging old positions
    if (isBufferSwitchRef.current) return;

    const selectionStart = inputRef.current.selectionStart;
    const selectionEnd = inputRef.current.selectionEnd;

    const position = calculateCursorPosition(selectionStart, lines);

    if (foldTransform.hasActiveFolds) {
      const actualLine = foldTransform.mapping.virtualToActual.get(position.line) ?? position.line;
      const actualOffset = calculateActualOffset(actualLines, actualLine, position.column);
      setCursorPosition({
        line: actualLine,
        column: position.column,
        offset: actualOffset,
      });
    } else {
      setCursorPosition(position);
    }

    if (selectionStart !== selectionEnd) {
      const startPos = calculateCursorPosition(selectionStart, lines);
      const endPos = calculateCursorPosition(selectionEnd, lines);
      const anchorOffset = Math.max(selectionStart, selectionEnd);
      const anchorPos = calculateCursorPosition(anchorOffset, lines);
      setInlineEditSelectionAnchor({ line: anchorPos.line, column: anchorPos.column });

      if (foldTransform.hasActiveFolds) {
        const actualStartLine =
          foldTransform.mapping.virtualToActual.get(startPos.line) ?? startPos.line;
        const actualEndLine = foldTransform.mapping.virtualToActual.get(endPos.line) ?? endPos.line;
        setSelection({
          start: {
            line: actualStartLine,
            column: startPos.column,
            offset: calculateActualOffset(actualLines, actualStartLine, startPos.column),
          },
          end: {
            line: actualEndLine,
            column: endPos.column,
            offset: calculateActualOffset(actualLines, actualEndLine, endPos.column),
          },
        });
      } else {
        setSelection({ start: startPos, end: endPos });
      }
    } else {
      setSelection(undefined);
      setInlineEditSelectionAnchor(null);
      if (inlineEditVisible) {
        inlineEditToolbarActions.hide();
      }
    }

    // Cursor movement/navigation should hide stale hover tooltip.
    const uiActions = useEditorUIStore.getState().actions;
    uiActions.setHoverInfo(null);
    uiActions.setIsHovering(false);
  }, [
    bufferId,
    lines,
    actualLines,
    setCursorPosition,
    setSelection,
    foldTransform,
    inlineEditVisible,
    inlineEditToolbarActions,
  ]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!bufferId || !inputRef.current) return;

      // Alt+click (Option+click on Mac) for multi-cursor (like VS Code)
      // Cmd+click is reserved for go-to-definition
      if (e.altKey) {
        e.preventDefault();

        const selectionStart = inputRef.current.selectionStart;
        const selectionEnd = inputRef.current.selectionEnd;
        const contentLines = splitLines(content);

        const clickedPosition = calculateCursorPosition(selectionStart, contentLines);

        const selection =
          selectionStart !== selectionEnd
            ? {
                start: calculateCursorPosition(selectionStart, contentLines),
                end: calculateCursorPosition(selectionEnd, contentLines),
              }
            : undefined;

        if (!multiCursorState) {
          // Enable multi-cursor mode - this creates a cursor at current position
          enableMultiCursor();
          // Only add a new cursor if clicked position is different from current cursor
          const isDifferentPosition =
            clickedPosition.line !== cursorPosition.line ||
            clickedPosition.column !== cursorPosition.column;
          if (isDifferentPosition) {
            addCursor(clickedPosition, selection);
          }
        } else {
          // Already in multi-cursor mode, just add the cursor
          addCursor(clickedPosition, selection);
        }
        return;
      }

      if (multiCursorState && multiCursorState.cursors.length > 1) {
        clearSecondaryCursors();
      }
    },
    [
      bufferId,
      content,
      multiCursorState,
      cursorPosition,
      enableMultiCursor,
      addCursor,
      clearSecondaryCursors,
    ],
  );

  const isLspCompletionVisible = useEditorUIStore.use.isLspCompletionVisible();
  const filteredCompletions = useEditorUIStore.use.filteredCompletions();
  const selectedLspIndex = useEditorUIStore.use.selectedLspIndex();
  const autocompleteCompletion = useEditorUIStore.use.autocompleteCompletion();
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();
  const { setSelectedLspIndex, setIsLspCompletionVisible, setAutocompleteCompletion } =
    useEditorUIStore.use.actions();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();
  const lspActions = useLspStore.use.actions();

  useAutocomplete({
    enabled: aiCompletionEnabled,
    model: aiAutocompleteModelId,
    filePath: filePath || null,
    languageId: filePath ? getLanguageId(filePath) : null,
    content,
    cursorOffset: cursorPosition.offset,
    lastInputTimestamp,
    hasActiveFolds: foldTransform.hasActiveFolds,
    setAutocompleteCompletion,
  });

  const handleApplyInlineEdit = useCallback(async () => {
    if (!buffer || !selection) {
      toast.warning("Select non-empty code before inline edit.");
      inlineEditToolbarActions.hide();
      return;
    }

    const startOffset = Math.min(selection.start.offset, selection.end.offset);
    const endOffset = Math.max(selection.start.offset, selection.end.offset);
    if (startOffset === endOffset) {
      toast.warning("Select non-empty code before inline edit.");
      inlineEditToolbarActions.hide();
      return;
    }

    const selectedText = buffer.content.slice(startOffset, endOffset);
    if (!selectedText.trim()) {
      toast.warning("Select non-empty code before inline edit.");
      inlineEditToolbarActions.hide();
      return;
    }

    if (!isAuthenticated) {
      toast.error("Please sign in to use inline edit.");
      return;
    }

    const subscriptionStatus = subscription?.status ?? "free";
    const enterprisePolicy = subscription?.enterprise?.policy;
    const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
    const isPro = subscriptionStatus === "pro" || subscriptionStatus === "trial";

    if (managedPolicy && !managedPolicy.aiCompletionEnabled) {
      toast.error("Inline edit is disabled by your organization policy.");
      return;
    }

    const useByok = managedPolicy ? managedPolicy.allowByok && !isPro : !isPro;
    if (managedPolicy && useByok && !managedPolicy.allowByok) {
      toast.error("BYOK is disabled by your organization policy.");
      return;
    }

    if (useByok && !hasOpenRouterKey) {
      await checkAllProviderApiKeys();
      const hasOpenRouterKeyAfterRefresh =
        useAIChatStore.getState().providerApiKeys.get("openrouter") || false;
      if (!hasOpenRouterKeyAfterRefresh) {
        toast.error("Free plan requires OpenRouter BYOK key for inline edit.");
        return;
      }
    }

    const beforeSelection = buffer.content.slice(0, startOffset);
    const afterSelection = buffer.content.slice(endOffset);

    setIsInlineEditRunning(true);

    try {
      const { editedText } = await requestInlineEdit(
        {
          model: aiAutocompleteModelId,
          beforeSelection,
          selectedText,
          afterSelection,
          instruction: inlineEditInstruction.trim() || DEFAULT_INLINE_EDIT_INSTRUCTION,
          filePath: buffer.path,
          languageId: buffer.language,
        },
        { useByok },
      );

      if (!editedText.trim()) {
        toast.warning("Inline edit returned an empty result.");
        return;
      }

      const newContent = `${beforeSelection}${editedText}${afterSelection}`;
      updateBufferContent(buffer.id, newContent, true);

      const newCursorOffset = startOffset + editedText.length;
      const newPosition = calculateCursorPosition(newCursorOffset, splitLines(newContent));
      setCursorPosition(newPosition);
      setSelection(undefined);
      setInlineEditSelectionAnchor(null);
      inlineEditToolbarActions.hide();
      if (inputRef.current) {
        inputRef.current.selectionStart = newCursorOffset;
        inputRef.current.selectionEnd = newCursorOffset;
      }

      toast.success("Inline edit applied.");
    } catch (error) {
      if (error instanceof InlineEditError) {
        toast.error(error.message);
      } else {
        toast.error("Inline edit failed. Please try again.");
      }
    } finally {
      setIsInlineEditRunning(false);
    }
  }, [
    buffer,
    selection,
    isAuthenticated,
    subscription,
    hasOpenRouterKey,
    checkAllProviderApiKeys,
    aiAutocompleteModelId,
    inlineEditInstruction,
    updateBufferContent,
    setCursorPosition,
    setSelection,
    inlineEditToolbarActions,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isAltGraph = isAltGraphPressed(e);
      const hasBlockedModifier =
        e.metaKey || (e.ctrlKey && !isAltGraph) || (e.altKey && !isAltGraph);
      const hasTextSelection = Boolean(
        selection && selection.start.offset !== selection.end.offset,
      );
      const isInlineEditShortcut =
        (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i";

      if (isInlineEditShortcut) {
        e.preventDefault();
        if (!hasTextSelection) {
          toast.warning("Select non-empty code before inline edit.");
          return;
        }
        inlineEditToolbarActions.show();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && inlineEditVisible) {
        e.preventDefault();
        void handleApplyInlineEdit();
        return;
      }

      if (e.key === "Escape" && inlineEditVisible) {
        e.preventDefault();
        if (isInlineEditRunning) return;
        inlineEditToolbarActions.hide();
        return;
      }

      if (!isAltGraph && e.altKey && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        const decorations = useEditorDecorationsStore.getState().decorations;
        const changedLines: number[] = [];

        decorations.forEach((dec: Decoration & { id: string }) => {
          if (dec.type === "gutter" && dec.className?.includes("git-gutter")) {
            changedLines.push(dec.range.start.line);
          }
        });

        if (changedLines.length === 0) return;

        changedLines.sort((a, b) => a - b);

        const currentLine = cursorPosition.line;

        if (e.key === "]") {
          const nextChange = changedLines.find((line) => line > currentLine);
          if (nextChange !== undefined) {
            const lineStart = calculateLineOffset(lines, nextChange);
            if (inputRef.current) {
              inputRef.current.selectionStart = lineStart;
              inputRef.current.selectionEnd = lineStart;
              inputRef.current.focus();
            }
            setCursorPosition(calculateCursorPosition(lineStart, lines));
          }
        } else {
          const prevChanges = changedLines.filter((line) => line < currentLine);
          if (prevChanges.length > 0) {
            const prevChange = prevChanges[prevChanges.length - 1];
            const lineStart = calculateLineOffset(lines, prevChange);
            if (inputRef.current) {
              inputRef.current.selectionStart = lineStart;
              inputRef.current.selectionEnd = lineStart;
              inputRef.current.focus();
            }
            setCursorPosition(calculateCursorPosition(lineStart, lines));
          }
        }
        return;
      }

      // Cmd+Shift+[ to fold, Cmd+Shift+] to unfold at cursor
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        const foldStoreActions = useFoldStore.getState().actions;
        if (!filePath) return;

        if (e.key === "[") {
          // Fold at current line if foldable
          if (foldStoreActions.isFoldable(filePath, cursorPosition.line)) {
            foldStoreActions.toggleFold(filePath, cursorPosition.line);
          }
        } else {
          // Unfold at current line if collapsed
          if (foldStoreActions.isCollapsed(filePath, cursorPosition.line)) {
            foldStoreActions.toggleFold(filePath, cursorPosition.line);
          }
        }
        return;
      }

      // Shift+Alt+Down/Up for column cursors (add cursor above/below current line)
      if (!isAltGraph && e.shiftKey && e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();

        const contentLines = splitLines(content);
        const targetLine =
          e.key === "ArrowDown" ? cursorPosition.line + 1 : cursorPosition.line - 1;

        // Bounds check
        if (targetLine < 0 || targetLine >= contentLines.length) return;

        // Calculate column (use same column or end of line if shorter)
        const targetLineText = contentLines[targetLine] || "";
        const targetColumn = Math.min(cursorPosition.column, targetLineText.length);

        // Calculate offset for the new position
        let offset = 0;
        for (let i = 0; i < targetLine; i++) {
          offset += (contentLines[i]?.length || 0) + 1;
        }
        offset += targetColumn;

        const newPosition: Position = {
          line: targetLine,
          column: targetColumn,
          offset,
        };

        if (!multiCursorState) {
          enableMultiCursor();
        }
        addCursor(newPosition);
        return;
      }

      // Cmd+D to select next occurrence
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();

        // Get current selection text or word under cursor
        let searchText = "";
        let selectionStart = inputRef.current?.selectionStart || 0;
        let selectionEnd = inputRef.current?.selectionEnd || 0;

        if (selectionStart !== selectionEnd) {
          // Use selected text
          searchText = content.substring(selectionStart, selectionEnd);
        } else {
          // Select word under cursor
          const contentLines = splitLines(content);
          const lineText = contentLines[cursorPosition.line] || "";
          const wordRegex = /[a-zA-Z0-9_]+/g;
          let match: RegExpExecArray | null;

          match = wordRegex.exec(lineText);
          while (match !== null) {
            const wordStart = match.index;
            const wordEnd = match.index + match[0].length;
            if (cursorPosition.column >= wordStart && cursorPosition.column <= wordEnd) {
              searchText = match[0];
              // Calculate offsets for this word
              let lineOffset = 0;
              for (let i = 0; i < cursorPosition.line; i++) {
                lineOffset += (contentLines[i]?.length || 0) + 1;
              }
              selectionStart = lineOffset + wordStart;
              selectionEnd = lineOffset + wordEnd;
              break;
            }
            match = wordRegex.exec(lineText);
          }
        }

        if (!searchText) return;

        // Find next occurrence
        const searchIndex = content.indexOf(searchText, selectionEnd);
        if (searchIndex === -1) return;

        // Calculate position from offset
        const contentLines = splitLines(content);
        let line = 0;
        let currentOffset = 0;
        for (let i = 0; i < contentLines.length; i++) {
          const lineLen = contentLines[i].length + 1;
          if (currentOffset + lineLen > searchIndex) {
            line = i;
            break;
          }
          currentOffset += lineLen;
        }
        const column = searchIndex - currentOffset;
        const endColumn = column + searchText.length;

        const newPosition: Position = {
          line,
          column: endColumn,
          offset: searchIndex + searchText.length,
        };

        const newSelection: Range = {
          start: { line, column, offset: searchIndex },
          end: { line, column: endColumn, offset: searchIndex + searchText.length },
        };

        // Enable multi-cursor if not already
        if (!multiCursorState) {
          enableMultiCursor();
          // Select the current word/selection for the primary cursor
          if (inputRef.current) {
            inputRef.current.selectionStart = selectionStart;
            inputRef.current.selectionEnd = selectionEnd;
          }
        }
        addCursor(newPosition, newSelection);
        return;
      }

      if (multiCursorState && multiCursorState.cursors.length > 1) {
        if (e.key === "Backspace") {
          e.preventDefault();

          const { newContent, newCursors } = applyMultiCursorBackspace(
            content,
            multiCursorState.cursors,
          );

          if (bufferId) {
            updateBufferContent(bufferId, newContent);
          }

          if (inputRef.current) {
            inputRef.current.value = newContent;
          }

          for (const cursor of newCursors) {
            updateCursor(cursor.id, cursor.position, cursor.selection);
          }

          const primaryCursor = newCursors.find((c) => c.id === multiCursorState.primaryCursorId);
          if (primaryCursor && inputRef.current) {
            inputRef.current.selectionStart = primaryCursor.position.offset;
            inputRef.current.selectionEnd = primaryCursor.position.offset;
          }

          // Tokenization handled by debounced useEffect watching buffer content
          return;
        }

        if (e.key.length === 1 || e.key === "Enter") {
          e.preventDefault();

          const text = e.key === "Enter" ? "\n" : e.key;
          const { newContent, newCursors } = applyMultiCursorEdit(
            content,
            multiCursorState.cursors,
            text,
          );

          if (bufferId) {
            updateBufferContent(bufferId, newContent);
          }

          if (inputRef.current) {
            inputRef.current.value = newContent;
          }

          for (const cursor of newCursors) {
            updateCursor(cursor.id, cursor.position, cursor.selection);
          }

          const primaryCursor = newCursors.find((c) => c.id === multiCursorState.primaryCursorId);
          if (primaryCursor && inputRef.current) {
            inputRef.current.selectionStart = primaryCursor.position.offset;
            inputRef.current.selectionEnd = primaryCursor.position.offset;
          }

          // Tokenization handled by debounced useEffect watching buffer content
          return;
        }
      }

      // Auto-pairing for single cursor editing
      if (inputRef.current && !hasBlockedModifier) {
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentContent = textarea.value;
        const selectedText = currentContent.substring(start, end);
        const nextChar = currentContent[start] || "";
        const prevChar = start > 0 ? currentContent[start - 1] : "";
        const currentLanguageId = filePath ? getLanguageId(filePath) : null;

        // CSS block comment expansion: typing * after / becomes /* */
        if (
          e.key === "*" &&
          start === end &&
          prevChar === "/" &&
          currentLanguageId &&
          BLOCK_COMMENT_LANGUAGES.has(currentLanguageId)
        ) {
          e.preventDefault();
          const insertText = "* */";
          const newContent =
            currentContent.substring(0, start) + insertText + currentContent.substring(end);
          const newCursorPos = start + 2; // Keep cursor between /* and */

          textarea.value = newContent;
          textarea.selectionStart = textarea.selectionEnd = newCursorPos;
          handleInput(newContent);
          return;
        }

        // Skip over existing closer if user types the same closer
        if (
          e.key.length === 1 &&
          start === end &&
          AUTO_PAIR_CLOSERS.has(e.key) &&
          nextChar === e.key
        ) {
          e.preventDefault();
          textarea.selectionStart = textarea.selectionEnd = start + 1;
          return;
        }

        // Auto-insert closing pair (also wraps selection)
        const closingPair = AUTO_PAIRS[e.key];
        if (e.key.length === 1 && closingPair) {
          // Prevent apostrophe pairing in words like don't
          if (e.key === "'" && /\w/.test(prevChar)) {
            return;
          }

          e.preventDefault();
          const newContent =
            currentContent.substring(0, start) +
            e.key +
            selectedText +
            closingPair +
            currentContent.substring(end);
          const newCursorPos = start + 1;
          const newSelectionEnd = start + 1 + selectedText.length;

          textarea.value = newContent;
          if (selectedText.length > 0) {
            textarea.selectionStart = newCursorPos;
            textarea.selectionEnd = newSelectionEnd;
          } else {
            textarea.selectionStart = textarea.selectionEnd = newCursorPos;
          }
          handleInput(newContent);
          return;
        }

        // Delete pair together when backspacing between pairs
        if (e.key === "Backspace" && start === end && start > 0) {
          const leftChar = currentContent[start - 1];
          const rightChar = currentContent[start] || "";
          const expectedRight = AUTO_PAIRS[leftChar];

          if (expectedRight && rightChar === expectedRight) {
            e.preventDefault();
            const newContent =
              currentContent.substring(0, start - 1) + currentContent.substring(start + 1);
            const newCursorPos = start - 1;
            textarea.value = newContent;
            textarea.selectionStart = textarea.selectionEnd = newCursorPos;
            handleInput(newContent);
            return;
          }
        }
      }

      if (
        autocompleteCompletion &&
        !isLspCompletionVisible &&
        e.key === "Tab" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        if (start === end && start === autocompleteCompletion.cursorOffset) {
          e.preventDefault();

          const currentContent = textarea.value;
          const newContent =
            currentContent.substring(0, start) +
            autocompleteCompletion.text +
            currentContent.substring(end);
          const newCursorPos = start + autocompleteCompletion.text.length;

          textarea.value = newContent;
          textarea.selectionStart = textarea.selectionEnd = newCursorPos;

          setAutocompleteCompletion(null);
          handleInput(newContent);
          return;
        }
      }

      if (isLspCompletionVisible && filteredCompletions.length > 0) {
        const maxIndex = filteredCompletions.length;

        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedLspIndex(selectedLspIndex < maxIndex - 1 ? selectedLspIndex + 1 : 0);
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedLspIndex(selectedLspIndex > 0 ? selectedLspIndex - 1 : maxIndex - 1);
          return;
        }

        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const selectedCompletion = filteredCompletions[selectedLspIndex]?.item;
          if (selectedCompletion) {
            const textarea = e.currentTarget;
            const currentContent = textarea.value;
            const cursorPos = textarea.selectionStart;

            const result = lspActions.applyCompletion({
              completion: selectedCompletion,
              value: currentContent,
              cursorPos,
            });

            textarea.value = result.newValue;
            textarea.selectionStart = textarea.selectionEnd = result.newCursorPos;

            handleInput(result.newValue);

            // Reset the applying flag after completion is applied
            // Use setTimeout to ensure it happens after the input handling cycle
            setTimeout(() => {
              useEditorUIStore.getState().actions.setIsApplyingCompletion(false);
            }, 0);
          }
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          setIsLspCompletionVisible(false);
          return;
        }
      }

      if (e.key === "Escape" && multiCursorState && multiCursorState.cursors.length > 1) {
        e.preventDefault();
        clearSecondaryCursors();
        return;
      }

      if (e.key === "Escape" && autocompleteCompletion) {
        e.preventDefault();
        setAutocompleteCompletion(null);
        return;
      }

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentContent = textarea.value;

        // Preserve indentation from the current line (spaces/tabs at line start).
        const lineStart = currentContent.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
        const currentLinePrefix = currentContent.slice(lineStart, start);
        const indentMatch = currentLinePrefix.match(/^[\t ]*/);
        const indent = indentMatch?.[0] ?? "";

        const inserted = `\n${indent}`;
        const newContent =
          currentContent.substring(0, start) + inserted + currentContent.substring(end);
        const newCursorPos = start + inserted.length;

        textarea.value = newContent;
        textarea.selectionStart = textarea.selectionEnd = newCursorPos;

        handleInput(newContent);
        return;
      }

      if (e.key === "Tab") {
        if (e.ctrlKey || e.metaKey) {
          return;
        }

        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const spaces = " ".repeat(tabSize);
        const currentContent = textarea.value;

        const newContent =
          currentContent.substring(0, start) + spaces + currentContent.substring(end);

        textarea.value = newContent;

        textarea.selectionStart = textarea.selectionEnd = start + spaces.length;

        handleInput(newContent);
      }
    },
    [
      tabSize,
      handleInput,
      isLspCompletionVisible,
      autocompleteCompletion,
      filteredCompletions,
      selectedLspIndex,
      setSelectedLspIndex,
      setIsLspCompletionVisible,
      setAutocompleteCompletion,
      lspActions,
      multiCursorState,
      clearSecondaryCursors,
      content,
      bufferId,
      updateBufferContent,
      updateCursor,
      tokenize,
      cursorPosition.line,
      cursorPosition.offset,
      setCursorPosition,
      lines,
      selection,
      inlineEditToolbarActions,
      inlineEditVisible,
      isInlineEditRunning,
      handleApplyInlineEdit,
    ],
  );

  const scrollRafRef = useRef<number | null>(null);
  const lastScrollRef = useRef({ top: 0, left: 0 });
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastStoreScrollUpdateRef = useRef(0);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      const scrollTop = e.currentTarget.scrollTop;
      const scrollLeft = e.currentTarget.scrollLeft;

      // Skip if scroll hasn't changed
      if (lastScrollRef.current.top === scrollTop && lastScrollRef.current.left === scrollLeft) {
        return;
      }

      lastScrollRef.current = { top: scrollTop, left: scrollLeft };
      isScrollingRef.current = true;

      // Capture buffer ID NOW, before RAF executes (buffer might change by then)
      const currentBufferId = bufferId;

      // Clear existing scroll timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Log scroll event for debugging
      scrollLogger.log(scrollTop, scrollLeft, "editor-scroll");

      // Single RAF for both transform updates and viewport tracking
      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(() => {
          const { top, left } = lastScrollRef.current;

          // Avoid full editor re-renders on scroll when minimap is hidden
          if (minimapEnabled) {
            setEditorScrollTop(top);
          }

          // Update highlight layer transform for visual sync
          if (highlightRef.current) {
            highlightRef.current.style.transform = `translate(-${left}px, -${top}px)`;
          }

          // Update multi-cursor layer transform for visual sync
          if (multiCursorRef.current) {
            multiCursorRef.current.style.transform = `translate(-${left}px, -${top}px)`;
          }

          // Update search highlight layer transform for visual sync
          if (searchHighlightRef.current) {
            searchHighlightRef.current.style.transform = `translate(-${left}px, -${top}px)`;
          }

          // Update selection layer transform for visual sync
          if (selectionLayerRef.current) {
            selectionLayerRef.current.style.transform = `translate(-${left}px, -${top}px)`;
          }

          // Update vim cursor layer transform for visual sync
          if (vimCursorRef.current) {
            vimCursorRef.current.style.transform = `translate(-${left}px, -${top}px)`;
          }

          // Update pro completion ghost layer transform for visual sync
          if (autocompleteCompletionRef.current) {
            autocompleteCompletionRef.current.style.transform = `translate(-${left}px, -${top}px)`;
          }

          if (inlineEditOverlayRef.current) {
            inlineEditOverlayRef.current.style.transform = `translate(-${left}px, -${top}px)`;
          }

          // Throttle store updates during active scrolling to reduce expensive
          // subscriber re-renders (notably on huge files).
          const now = performance.now();
          if (now - lastStoreScrollUpdateRef.current >= SCROLL_STATE_UPDATE_INTERVAL_MS) {
            useEditorStateStore.getState().actions.setScrollForBuffer(currentBufferId, top, left);
            lastStoreScrollUpdateRef.current = now;
          }

          // Update viewport tracking in the same RAF
          handleViewportScroll(top, lines.length);

          scrollRafRef.current = null;
        });
      }

      // Mark scrolling as finished after 150ms of no scroll events
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
        const { top, left } = lastScrollRef.current;
        useEditorStateStore.getState().actions.setScrollForBuffer(currentBufferId, top, left);
        lastStoreScrollUpdateRef.current = performance.now();
      }, 150);
    },
    [bufferId, handleViewportScroll, lines.length, minimapEnabled],
  );

  useEffect(() => {
    if (inputRef.current) {
      initializeViewport(inputRef.current, lines.length);
    }
  }, [initializeViewport, lines.length]);

  // Set textarea ref in editorAPI for operations like selectAll
  useEffect(() => {
    editorAPI.setTextareaRef(inputRef.current);
    return () => {
      editorAPI.setTextareaRef(null);
    };
  }, [inputRef]);

  // Cleanup scroll RAF and timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Keep native wheel behavior on macOS for high-frequency trackpad scrolling and momentum.
  // On non-macOS platforms we keep manual forwarding for WebView consistency.
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    if (typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")) {
      return;
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // Scroll on whichever axis has more movement
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        textarea.scrollLeft += e.deltaX;
      } else {
        textarea.scrollTop += e.deltaY;
      }
    };

    textarea.addEventListener("wheel", handleWheel, { passive: false });
    return () => textarea.removeEventListener("wheel", handleWheel);
  }, []);

  // Track viewport height for cursor visibility calculations
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const updateViewportHeight = () => {
      const height = textarea.clientHeight;
      if (height > 0) {
        useEditorStateStore.getState().actions.setViewportHeight(height);
        setEditorViewportHeight(height);
      }
    };

    updateViewportHeight();

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(textarea);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Tokenization scheduled via requestAnimationFrame for smooth updates
  const tokenizeRafRef = useRef<number | null>(null);
  const tokenizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!buffer?.content || !buffer?.path) return;

    // Clear any pending tokenization
    if (tokenizeRafRef.current !== null) {
      cancelAnimationFrame(tokenizeRafRef.current);
    }
    if (tokenizeTimeoutRef.current !== null) {
      clearTimeout(tokenizeTimeoutRef.current);
    }

    const contentToTokenize = foldTransform.hasActiveFolds ? displayContent : buffer.content;
    const isLargeFile = lines.length >= LARGE_FILE_SCROLL_OPTIMIZATION_THRESHOLD;

    // Defer tokenization while actively scrolling very large files to keep
    // scroll handling on the main thread responsive.
    if (isLargeFile && isScrollingRef.current) {
      tokenizeTimeoutRef.current = setTimeout(() => {
        tokenize(contentToTokenize, viewportRange);
        tokenizeTimeoutRef.current = null;
      }, LARGE_FILE_SCROLL_TOKENIZE_DEBOUNCE_MS);

      return () => {
        if (tokenizeTimeoutRef.current !== null) {
          clearTimeout(tokenizeTimeoutRef.current);
        }
      };
    }

    // Use requestAnimationFrame for smooth tokenization
    // This batches updates to the next frame without visible delay
    tokenizeRafRef.current = requestAnimationFrame(() => {
      tokenize(contentToTokenize, viewportRange);
      tokenizeRafRef.current = null;
    });

    return () => {
      if (tokenizeRafRef.current !== null) {
        cancelAnimationFrame(tokenizeRafRef.current);
      }
      if (tokenizeTimeoutRef.current !== null) {
        clearTimeout(tokenizeTimeoutRef.current);
      }
    };
  }, [
    bufferId,
    buffer?.path,
    buffer?.content,
    tokenize,
    foldTransform.hasActiveFolds,
    displayContent,
    lines.length,
    viewportRange,
  ]);

  // Restore cursor and scroll position when switching buffers
  // Using useLayoutEffect to apply scroll before paint, avoiding visual flash
  useLayoutEffect(() => {
    if (!bufferId) return;

    // Only restore when bufferId changes (not on initial mount)
    if (prevBufferIdRef.current !== null && prevBufferIdRef.current !== bufferId) {
      isBufferSwitchRef.current = true;
      useEditorStateStore.getState().actions.restorePositionForFile(bufferId);
    }
    prevBufferIdRef.current = bufferId;
  }, [bufferId]);

  useEffect(() => {
    if (inputRef.current && bufferId) {
      const applyPosition = () => {
        if (inputRef.current && bufferId) {
          const offset = cursorPosition.offset || 0;
          const maxOffset = inputRef.current.value.length;
          const safeOffset = Math.min(offset, maxOffset);
          if (inputRef.current.selectionStart === inputRef.current.selectionEnd) {
            inputRef.current.selectionStart = safeOffset;
            inputRef.current.selectionEnd = safeOffset;
          }
          // Save scroll before focus (focus can scroll to show cursor)
          const scrollTop = inputRef.current.scrollTop;
          const scrollLeft = inputRef.current.scrollLeft;
          inputRef.current.focus({ preventScroll: true });
          // Restore scroll in case focus changed it
          inputRef.current.scrollTop = scrollTop;
          inputRef.current.scrollLeft = scrollLeft;
          // Clear the buffer switch flag after cursor is positioned
          isBufferSwitchRef.current = false;
        }
      };

      if (isBufferSwitchRef.current) {
        // During buffer switch, wait for next frame to ensure content is synced
        requestAnimationFrame(applyPosition);
      } else {
        setTimeout(applyPosition, 0);
      }
    }
  }, [bufferId, cursorPosition.offset]);

  const handleLineClick = useCallback(
    (lineIndex: number) => {
      if (!inputRef.current) return;

      const lineStart = calculateLineOffset(lines, lineIndex);
      const lineEnd = lineStart + lines[lineIndex].length;

      inputRef.current.selectionStart = lineStart;
      inputRef.current.selectionEnd = lineEnd;
      inputRef.current.focus();

      const startPos = calculateCursorPosition(lineStart, lines);
      const endPos = calculateCursorPosition(lineEnd, lines);
      setCursorPosition(startPos);
      setSelection({ start: startPos, end: endPos });
    },
    [lines, setCursorPosition, setSelection],
  );

  const handleRevertChange = useCallback(
    (lineIndex: number, originalContent: string) => {
      if (!bufferId) return;
      const newLines = [...lines];
      newLines[lineIndex] = originalContent;
      const newContent = newLines.join("\n");
      updateBufferContent(bufferId, newContent);
      if (inputRef.current) {
        inputRef.current.value = newContent;
      }
      // Tokenization handled by debounced useEffect watching buffer content
    },
    [lines, bufferId, updateBufferContent],
  );

  const inlineAutocompletePreview = useMemo(() => {
    if (!autocompleteCompletion || isLspCompletionVisible) return null;
    if (autocompleteCompletion.cursorOffset !== cursorPosition.offset) return null;
    if (visualCursorLine < 0 || visualCursorLine >= lines.length) return null;

    const normalized = autocompleteCompletion.text.replace(/\r\n/g, "\n");
    if (!normalized) return null;

    const lineText = lines[visualCursorLine] || "";
    const cursorColumn = Math.min(cursorPosition.column, lineText.length);
    const cursorX = getAccurateCursorX(lineText, cursorColumn, fontSize, fontFamily, tabSize);

    return {
      text: normalized,
      top: visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      left: cursorX + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
    };
  }, [
    autocompleteCompletion,
    isLspCompletionVisible,
    cursorPosition.offset,
    cursorPosition.column,
    visualCursorLine,
    lines,
    fontSize,
    fontFamily,
    tabSize,
    lineHeight,
  ]);

  const inlineEditPopoverPosition = useMemo(() => {
    if (!inlineEditVisible || !inlineEditSelectionAnchor) return null;
    if (inlineEditSelectionAnchor.line < 0 || inlineEditSelectionAnchor.line >= lines.length) {
      return null;
    }

    const lineText = lines[inlineEditSelectionAnchor.line] || "";
    const anchorColumn = Math.min(inlineEditSelectionAnchor.column, lineText.length);
    const anchorX = getAccurateCursorX(lineText, anchorColumn, fontSize, fontFamily, tabSize);
    const anchorTop =
      inlineEditSelectionAnchor.line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
    const textarea = inputRef.current;
    const scrollLeft = textarea?.scrollLeft ?? lastScrollRef.current.left;
    const scrollTop = textarea?.scrollTop ?? lastScrollRef.current.top;
    const viewportWidth =
      textarea?.clientWidth ?? INLINE_EDIT_POPOVER_WIDTH + INLINE_EDIT_POPOVER_MARGIN * 2;
    const viewportHeight =
      textarea?.clientHeight ??
      INLINE_EDIT_POPOVER_ESTIMATED_HEIGHT + INLINE_EDIT_POPOVER_MARGIN * 2;

    const minLeft = scrollLeft + INLINE_EDIT_POPOVER_MARGIN;
    const maxLeft = Math.max(
      minLeft,
      scrollLeft + viewportWidth - INLINE_EDIT_POPOVER_WIDTH - INLINE_EDIT_POPOVER_MARGIN,
    );
    const rawLeft = anchorX + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + INLINE_EDIT_POPOVER_X_OFFSET;
    const clampedLeft = Math.min(Math.max(rawLeft, minLeft), maxLeft);

    const minTop = scrollTop + INLINE_EDIT_POPOVER_MARGIN;
    const maxTop = Math.max(
      minTop,
      scrollTop +
        viewportHeight -
        INLINE_EDIT_POPOVER_ESTIMATED_HEIGHT -
        INLINE_EDIT_POPOVER_MARGIN,
    );
    const preferBelow = anchorTop - scrollTop < INLINE_EDIT_TOP_THRESHOLD;
    const belowTop = anchorTop + lineHeight + INLINE_EDIT_POPOVER_Y_OFFSET;
    const aboveTop =
      anchorTop - INLINE_EDIT_POPOVER_ESTIMATED_HEIGHT - INLINE_EDIT_POPOVER_Y_OFFSET;
    let top = preferBelow ? belowTop : aboveTop;
    if (top < minTop) {
      top = belowTop;
    }
    const clampedTop = Math.min(Math.max(top, minTop), maxTop);

    return {
      top: clampedTop,
      left: clampedLeft,
    };
  }, [
    inlineEditVisible,
    inlineEditSelectionAnchor,
    lines,
    fontSize,
    fontFamily,
    tabSize,
    lineHeight,
  ]);

  if (!buffer) return null;

  return (
    <div className="absolute inset-0 flex">
      {showLineNumbers && (
        <Gutter
          totalLines={lines.length}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          textareaRef={inputRef}
          virtualize={shouldVirtualizeRendering}
          filePath={filePath}
          onLineClick={handleLineClick}
          onGitIndicatorClick={inlineDiff.toggle}
          foldMapping={foldTransform.hasActiveFolds ? foldTransform.mapping : undefined}
        />
      )}

      <div
        className={`overlay-editor-container relative min-h-0 min-w-0 flex-1 bg-primary-bg ${className || ""}`}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        {hasSyntaxHighlighting && (
          <HighlightLayer
            ref={highlightRef}
            content={tokenizedContent || displayContent}
            tokens={tokens}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
          />
        )}
        <InputLayer
          textareaRef={inputRef}
          content={displayContent}
          filePath={filePath}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onSelect={handleCursorChange}
          onClick={handleClick}
          onContextMenu={contextMenu.open}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          bufferId={bufferId || undefined}
          showText={!hasSyntaxHighlighting}
        />
        <SelectionLayer
          ref={selectionLayerRef}
          textareaRef={inputRef}
          content={displayContent}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
        />
        {inlineEditVisible && inlineEditPopoverPosition && (
          <div ref={inlineEditOverlayRef} className="pointer-events-none absolute inset-0 z-[200]">
            <div
              ref={inlineEditPopoverRef}
              className="pointer-events-auto absolute w-80 overflow-hidden rounded-2xl border border-border bg-primary-bg/95 backdrop-blur-sm"
              style={{
                top: `${inlineEditPopoverPosition.top}px`,
                left: `${inlineEditPopoverPosition.left}px`,
              }}
            >
              <div className="p-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={inlineEditInstructionRef}
                    value={inlineEditInstruction}
                    onChange={(e) => setInlineEditInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleApplyInlineEdit();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        if (!isInlineEditRunning) {
                          inlineEditToolbarActions.hide();
                        }
                      }
                    }}
                    className="ui-font h-8 flex-1 bg-transparent px-1.5 text-text text-xs outline-none placeholder:text-text-lighter/80"
                    placeholder="Describe the edit you want..."
                  />
                  <InlineEditModelSelector
                    models={inlineEditModels}
                    value={aiAutocompleteModelId}
                    onChange={(modelId) => updateSetting("aiAutocompleteModelId", modelId)}
                    disabled={isInlineEditRunning}
                    isLoading={isInlineEditModelLoading}
                  />
                  <button
                    onClick={() => inlineEditToolbarActions.hide()}
                    className="rounded-lg p-1.5 text-text-lighter hover:bg-hover hover:text-text"
                    aria-label="Close inline edit"
                  >
                    <X size={13} />
                  </button>
                  <button
                    onClick={() => void handleApplyInlineEdit()}
                    disabled={isInlineEditRunning}
                    className="ui-font flex h-8 items-center gap-1 rounded-lg border border-accent bg-accent px-2 text-white text-xs hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CornerDownLeft size={11} />
                    {isInlineEditRunning ? "Applying..." : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {inlineAutocompletePreview && (
          <div
            ref={autocompleteCompletionRef}
            className="pointer-events-none absolute inset-0 z-[3]"
          >
            <div
              style={{
                position: "absolute",
                top: `${inlineAutocompletePreview.top}px`,
                left: `${inlineAutocompletePreview.left}px`,
                fontSize: `${fontSize}px`,
                fontFamily,
                lineHeight: `${lineHeight}px`,
                whiteSpace: "pre",
                opacity: 0.42,
                color: "var(--text-lighter, #94a3b8)",
              }}
            >
              {inlineAutocompletePreview.text}
            </div>
          </div>
        )}
        {autocompleteCompletion && !isLspCompletionVisible && !inlineAutocompletePreview && (
          <div className="pointer-events-none absolute right-3 bottom-3 z-40 rounded-md bg-primary-bg/80 px-2 py-1 text-[11px] text-text-lighter/80">
            Tab to accept AI suggestion
          </div>
        )}
        {multiCursorState && (
          <MultiCursorLayer
            ref={multiCursorRef}
            cursors={multiCursorState.cursors}
            primaryCursorId={multiCursorState.primaryCursorId}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            content={displayContent}
          />
        )}

        {vimModeEnabled && (
          <VimCursorLayer
            ref={vimCursorRef}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            content={displayContent}
            vimMode={vimMode}
          />
        )}

        {searchMatches.length > 0 && (
          <SearchHighlightLayer
            ref={searchHighlightRef}
            searchMatches={searchMatches}
            currentMatchIndex={currentMatchIndex}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            content={displayContent}
            viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
          />
        )}

        <DefinitionLinkLayer
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          content={displayContent}
          textareaRef={inputRef}
        />

        {filePath && (
          <GitBlameLayer
            filePath={filePath}
            cursorLine={cursorPosition.line}
            visualCursorLine={visualCursorLine}
            visualContent={displayContent}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            textareaRef={inputRef}
          />
        )}

        {inlineDiff.state.isOpen && (
          <InlineDiff
            lineNumber={inlineDiff.state.lineNumber}
            type={inlineDiff.state.type}
            diffLines={inlineDiff.state.diffLines}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            onClose={inlineDiff.close}
            onRevert={handleRevertChange}
          />
        )}
      </div>

      {/* Minimap */}
      {minimapEnabled && (
        <Minimap
          content={displayContent}
          tokens={tokens}
          scrollTop={editorScrollTop}
          viewportHeight={editorViewportHeight}
          totalHeight={lines.length * lineHeight}
          lineHeight={lineHeight}
          scale={minimapScale}
          width={minimapWidth}
          onScrollTo={(scrollTop) => {
            if (inputRef.current) {
              inputRef.current.scrollTop = scrollTop;
            }
          }}
        />
      )}

      {contextMenu.state.isOpen &&
        createPortal(
          <EditorContextMenu
            isOpen={contextMenu.state.isOpen}
            position={contextMenu.state.position}
            onClose={contextMenu.close}
            onCopy={editorOps.copy}
            onCut={editorOps.cut}
            onPaste={editorOps.paste}
            onSelectAll={editorOps.selectAll}
            onDelete={editorOps.deleteSelection}
          />,
          document.body,
        )}
    </div>
  );
}
