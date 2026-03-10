import { useCallback, useEffect, useRef, useState } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/stores/auth-store";
import { useInlineEditToolbarStore } from "@/stores/inline-edit-toolbar-store";
import { toast } from "@/stores/toast-store";
import { type AutocompleteModel, fetchAutocompleteModels } from "@/utils/autocomplete";
import { InlineEditError, requestInlineEdit } from "@/utils/inline-edit";
import { EDITOR_CONSTANTS } from "../config/constants";
import type { Position, Range } from "../types/editor";
import { splitLines } from "../utils/lines";
import { calculateCursorPosition, getAccurateCursorX } from "../utils/position";

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

  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const hasOpenRouterKey = useAIChatStore(
    (state) => state.providerApiKeys.get("openrouter") || false,
  );
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);

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

  useEffect(() => {
    if (!inlineEditVisible || inlineEditSelectionAnchor || !inputRef.current) return;
    const start = inputRef.current.selectionStart;
    const end = inputRef.current.selectionEnd;
    if (start === end) return;
    const anchorPos = calculateCursorPosition(Math.max(start, end), lines);
    setInlineEditSelectionAnchor({ line: anchorPos.line, column: anchorPos.column });
  }, [inlineEditVisible, inlineEditSelectionAnchor, lines, inputRef]);

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
