import { useCallback, useEffect, useRef, useState } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar-store";
import { toast } from "@/ui/toast";
import {
  type AutocompleteModel,
  fetchAutocompleteModels,
} from "@/features/editor/services/editor-autocomplete-service";
import {
  InlineEditError,
  requestInlineEdit,
} from "@/features/editor/services/editor-inline-edit-service";
import { EDITOR_CONSTANTS } from "../config/constants";
import type { Position, Range } from "../types/editor";
import { splitLines } from "../utils/lines";
import {
  calculateCursorPosition,
  calculateOffsetFromPosition,
  getAccurateCursorX,
} from "../utils/position";

const DEFAULT_INLINE_EDIT_INSTRUCTION = "Improve this code while preserving behavior.";
const DEFAULT_INLINE_EDIT_MODELS: AutocompleteModel[] = [
  { id: "mistralai/devstral-small", name: "Devstral Small 1.1" },
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
  { id: "openai/gpt-5-nano", name: "GPT-5 Nano" },
  { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
];
const INLINE_EDIT_POPOVER_WIDTH = 320;
const INLINE_EDIT_POPOVER_ESTIMATED_HEIGHT = 170;
const INLINE_EDIT_POPOVER_MARGIN = 8;
const INLINE_EDIT_POPOVER_X_OFFSET = 10;
const INLINE_EDIT_POPOVER_Y_OFFSET = 10;
const INLINE_EDIT_TOP_THRESHOLD = 64;

interface UseInlineEditOptions {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  buffer: { id: string; content: string; path: string; language: string } | undefined;
  selection: Range | undefined;
  lines: string[];
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  lastScrollRef: React.RefObject<{ top: number; left: number }>;
  setCursorPosition: (position: Position) => void;
  setSelection: (selection?: Range) => void;
  updateBufferContent: (bufferId: string, content: string, snapshot?: boolean) => void;
}

export function useInlineEdit({
  inputRef,
  buffer,
  selection,
  lines,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize,
  lastScrollRef,
  setCursorPosition,
  setSelection,
  updateBufferContent,
}: UseInlineEditOptions) {
  const inlineEditVisible = useInlineEditToolbarStore.use.isVisible();
  const inlineEditToolbarActions = useInlineEditToolbarStore.use.actions();
  const inlineEditPopoverRef = useRef<HTMLDivElement>(null);
  const inlineEditInstructionRef = useRef<HTMLInputElement>(null);
  const focusRestoreRef = useRef<HTMLElement | null>(null);

  const [inlineEditInstruction, setInlineEditInstruction] = useState("");
  const [isInlineEditRunning, setIsInlineEditRunning] = useState(false);
  const [isInlineEditModelLoading, setIsInlineEditModelLoading] = useState(false);
  const [inlineEditError, setInlineEditError] = useState<string | null>(null);
  const [inlineEditModels, setInlineEditModels] = useState<AutocompleteModel[]>(
    DEFAULT_INLINE_EDIT_MODELS,
  );
  const [inlineEditSelectionAnchor, setInlineEditSelectionAnchor] = useState<{
    line: number;
    column: number;
  } | null>(null);

  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const hasOpenRouterKey = useAIChatStore(
    (state) => state.providerApiKeys.get("openrouter") || false,
  );
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);

  useEffect(() => {
    if (!inlineEditVisible) {
      setInlineEditError(null);
      const restoreTarget = focusRestoreRef.current;
      focusRestoreRef.current = null;
      if (restoreTarget && document.contains(restoreTarget)) {
        requestAnimationFrame(() => restoreTarget.focus());
      }
      return;
    }

    focusRestoreRef.current = document.activeElement as HTMLElement | null;
    setInlineEditInstruction("");
    setInlineEditError(null);

    let cancelled = false;
    let attempt = 0;

    const focusInstructionInput = () => {
      if (cancelled) return;

      const input = inlineEditInstructionRef.current;
      if (!input) {
        if (attempt < 4) {
          attempt += 1;
          requestAnimationFrame(focusInstructionInput);
        }
        return;
      }

      input.focus({ preventScroll: true });
      input.select();

      if (document.activeElement !== input && attempt < 4) {
        attempt += 1;
        requestAnimationFrame(focusInstructionInput);
      }
    };

    requestAnimationFrame(focusInstructionInput);

    return () => {
      cancelled = true;
    };
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
    if (!inlineEditVisible) {
      setInlineEditSelectionAnchor(null);
      return;
    }
    if (inlineEditSelectionAnchor || !inputRef.current) return;
    const start = inputRef.current.selectionStart;
    const end = inputRef.current.selectionEnd;
    const anchorPos = calculateCursorPosition(Math.max(start, end), lines);
    setInlineEditSelectionAnchor({ line: anchorPos.line, column: anchorPos.column });
  }, [inlineEditVisible, inlineEditSelectionAnchor, lines, inputRef]);

  const resolveInlineEditRange = useCallback((): Range | null => {
    if (selection && selection.start.offset !== selection.end.offset) {
      const start =
        selection.start.offset <= selection.end.offset ? selection.start : selection.end;
      const end = selection.start.offset <= selection.end.offset ? selection.end : selection.start;
      return { start, end };
    }

    const textarea = inputRef.current;
    if (!textarea || lines.length === 0) {
      return null;
    }

    const cursorOffset = textarea.selectionStart;
    const cursorPosition = calculateCursorPosition(cursorOffset, lines);
    const lineText = lines[cursorPosition.line] ?? "";
    const lineStartOffset = calculateOffsetFromPosition(cursorPosition.line, 0, lines);
    const lineEndOffset = lineStartOffset + lineText.length;

    return {
      start: {
        line: cursorPosition.line,
        column: 0,
        offset: lineStartOffset,
      },
      end: {
        line: cursorPosition.line,
        column: lineText.length,
        offset: lineEndOffset,
      },
    };
  }, [inputRef, lines, selection]);

  const handleApplyInlineEdit = useCallback(async () => {
    if (!buffer) {
      toast.warning("Inline edit requires an open buffer.");
      inlineEditToolbarActions.hide();
      return;
    }

    const targetRange = resolveInlineEditRange();
    if (!targetRange) {
      toast.warning("Could not determine an inline edit target.");
      inlineEditToolbarActions.hide();
      return;
    }

    const startOffset = targetRange.start.offset;
    const endOffset = targetRange.end.offset;
    const selectedText = buffer.content.slice(startOffset, endOffset);

    if (!aiAutocompleteModelId.trim()) {
      toast.error("Please select an inline edit model.");
      return;
    }

    if (!isAuthenticated) {
      toast.error("Please sign in to use inline edit.");
      return;
    }

    const subscriptionStatus = subscription?.status ?? "free";
    const enterprisePolicy = subscription?.enterprise?.policy;
    const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
    const isPro = subscriptionStatus === "pro";

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

    const beforeSelection = buffer.content.slice(Math.max(0, startOffset - 12000), startOffset);
    const afterSelection = buffer.content.slice(endOffset, endOffset + 12000);

    setInlineEditError(null);
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
      const errorMessage =
        error instanceof InlineEditError ? error.message : "Inline edit failed. Please try again.";
      setInlineEditError(errorMessage);
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
    resolveInlineEditRange,
    isAuthenticated,
    subscription,
    hasOpenRouterKey,
    checkAllProviderApiKeys,
    aiAutocompleteModelId,
    inlineEditInstruction,
    inlineEditError,
    updateBufferContent,
    setCursorPosition,
    setSelection,
    inlineEditToolbarActions,
    inputRef,
  ]);

  const popoverPosition = (() => {
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
  })();

  return {
    inlineEditVisible,
    inlineEditInstruction,
    setInlineEditInstruction,
    inlineEditError,
    setInlineEditError,
    isInlineEditRunning,
    isInlineEditModelLoading,
    inlineEditModels,
    inlineEditSelectionAnchor,
    setInlineEditSelectionAnchor,
    inlineEditPopoverRef,
    inlineEditInstructionRef,
    inlineEditToolbarActions,
    aiAutocompleteModelId,
    updateSetting,
    handleApplyInlineEdit,
    popoverPosition,
  };
}
