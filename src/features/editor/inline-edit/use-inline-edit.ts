import {
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  canUseIntelligenceProvider,
  canUseProviderWithoutApiKey,
} from "@/features/ai/lib/provider-access";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { getProviderById } from "@/features/ai/types/providers.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";
import { resolveIntelligenceConnection } from "@/features/ai/intelligence/lib/resolve-intelligence-connection";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar.store";
import { toast } from "sonner";
import {
  InlineEditError,
  requestInlineEdit,
} from "@/features/editor/services/editor-inline-edit-service";
import { rebaseInlineEditRange } from "./inline-edit-rebase";
import type { InlineEditPreview } from "./monaco-inline-edit-preview";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { buildLineOffsets } from "@/features/editor/engines/monaco/position";
import type { Position, Range } from "@/features/editor/types/editor.types";
import {
  calculateCursorPositionFromContent,
  calculateCursorPositionFromLineOffsets,
  calculateOffsetFromPosition,
  getAccurateCursorX,
} from "@/features/editor/utils/position";

type InlineEditModelPositionResolver = (
  line: number,
  column: number,
) => { top: number; left: number } | null;
type InlineEditAnchor = { line: number; column: number };

const DEFAULT_INLINE_EDIT_INSTRUCTION = "Improve this code while preserving behavior.";
const INLINE_EDIT_TIMEOUT_MS = 60_000;
const INLINE_EDIT_CONTEXT_CHARS = 12_000;
const INLINE_EDIT_INSTRUCTION_LIMIT = 2000;
const INLINE_EDIT_TOP_THRESHOLD = 64;
const EMPTY_LINES = [""];
const EMPTY_LINE_OFFSETS = [0];
const CONFLICT_MESSAGE =
  "The selected code changed while the edit was running. Run the edit again with the latest content.";

interface InlineEditProposal {
  bufferId: string;
  baseContent: string;
  startOffset: number;
  endOffset: number;
  originalText: string;
  editedText: string;
  instruction: string;
  lost?: boolean;
}

export function composeInlineEditFollowUp(previousInstruction: string, followUp: string) {
  const suffix = ` The selection is your previous proposal. Revise it: ${followUp}`;
  const budget = Math.max(0, INLINE_EDIT_INSTRUCTION_LIMIT - suffix.length - 20);
  const previous =
    previousInstruction.length > budget
      ? `${previousInstruction.slice(0, Math.max(0, budget - 3))}...`
      : previousInstruction;
  return `Original request: ${previous}.${suffix}`.slice(0, INLINE_EDIT_INSTRUCTION_LIMIT);
}

interface UseInlineEditOptions {
  enabled?: boolean;
  viewKey?: string | null;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  buffer: { id: string; content: string; path: string; language: string } | undefined;
  selection: Range | undefined;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  lastScrollRef: React.RefObject<{ top: number; left: number }>;
  resolveModelPosition?: InlineEditModelPositionResolver;
  getCursorOffset?: () => number | null;
  getSelectionAnchor?: () => { line: number; column: number } | null;
  getViewportMetrics?: () => {
    scrollTop: number;
    scrollLeft: number;
    viewportWidth: number;
    viewportHeight: number;
  } | null;
  applyInlineEdit?: (edit: {
    range: Range;
    editedText: string;
    newContent: string;
    newCursorOffset: number;
    newPosition: Position;
  }) => void;
  setCursorPosition: (position: Position) => void;
  setSelection: (selection?: Range) => void;
  updateBufferContent?: (bufferId: string, content: string, snapshot?: boolean) => void;
  previewInlineEdit?: (preview: InlineEditPreview) => () => void;
}

export function useInlineEdit({
  enabled = true,
  viewKey,
  inputRef,
  buffer,
  selection,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize,
  lastScrollRef,
  resolveModelPosition,
  getCursorOffset,
  getSelectionAnchor,
  getViewportMetrics,
  applyInlineEdit,
  setCursorPosition,
  setSelection,
  updateBufferContent,
  previewInlineEdit,
}: UseInlineEditOptions) {
  const inlineEditRequested = useInlineEditToolbarStore.use.isVisible();
  const inlineEditTargetViewKey = useInlineEditToolbarStore.use.targetViewKey();
  const inlineEditRequestId = useInlineEditToolbarStore.use.requestId();
  const inlineEditVisible =
    enabled &&
    inlineEditRequested &&
    (!inlineEditTargetViewKey || !viewKey || inlineEditTargetViewKey === viewKey);
  const inlineEditContent = buffer?.content ?? "";
  const lines = useMemo(
    () => (inlineEditVisible ? inlineEditContent.split(/\r?\n/) : EMPTY_LINES),
    [inlineEditContent, inlineEditVisible],
  );
  const lineOffsets = useMemo(
    () => (inlineEditVisible ? buildLineOffsets(inlineEditContent) : EMPTY_LINE_OFFSETS),
    [inlineEditContent, inlineEditVisible],
  );
  const inlineEditToolbarActions = useInlineEditToolbarStore.use.actions();
  const inlineEditPopoverRef = useRef<HTMLDivElement>(null);
  const inlineEditInstructionRef = useRef<HTMLInputElement>(null);
  const focusRestoreRef = useRef<HTMLElement | null>(null);

  const inlineEditSessionKey = inlineEditVisible
    ? `${inlineEditRequestId}:${inlineEditTargetViewKey ?? ""}:${viewKey ?? ""}`
    : null;
  const [inlineEditInstructionState, setInlineEditInstructionState] = useState<{
    sessionKey: string | null;
    value: string;
  }>({ sessionKey: null, value: "" });
  const [isInlineEditRunning, setIsInlineEditRunning] = useState(false);
  const [proposalState, setProposalState] = useState<{
    sessionKey: string | null;
    value: InlineEditProposal | null;
  }>({ sessionKey: null, value: null });
  const requestScopeRef = useRef<{
    content: string;
    ranges: Set<{ start: number; end: number; lost: boolean }>;
  } | null>(null);
  const pendingRequestRef = useRef<{ controller: AbortController } | null>(null);

  useLayoutEffect(() => {
    const scope = { content: "", ranges: new Set<{ start: number; end: number; lost: boolean }>() };
    requestScopeRef.current = scope;
    pendingRequestRef.current = null;
    setIsInlineEditRunning(false);
    return () => {
      requestScopeRef.current = null;
      pendingRequestRef.current?.controller.abort();
      pendingRequestRef.current = null;
    };
  }, [buffer?.id, inlineEditSessionKey]);

  // Follows every content change one step at a time, so ranges survive edits made in several
  // places while a request runs as long as none of them touch the range itself.
  useLayoutEffect(() => {
    const scope = requestScopeRef.current;
    if (!scope) return;
    for (const range of scope.ranges) {
      if (range.lost) continue;
      const next = rebaseInlineEditRange(scope.content, inlineEditContent, range.start, range.end);
      if (next) Object.assign(range, next);
      else range.lost = true;
    }
    scope.content = inlineEditContent;
  }, [inlineEditContent, buffer?.id, inlineEditSessionKey]);

  const [inlineEditErrorState, setInlineEditErrorState] = useState<{
    sessionKey: string | null;
    value: string | null;
  }>({ sessionKey: null, value: null });
  const [inlineEditSelectionAnchorState, setInlineEditSelectionAnchorState] = useState<{
    sessionKey: string | null;
    value: InlineEditAnchor | null;
  }>({ sessionKey: null, value: null });

  const personalProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const personalModelId = useSettingsStore((state) => state.settings.aiModelId);
  const intelligencePreferences = useIntelligenceSettingsStore((state) => state.preferences);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const connection = resolveIntelligenceConnection({
    task: "inline-edit",
    preferences: intelligencePreferences,
    hasIntelligence: hasProductCapability(subscription, "intelligence"),
    personalConnection: { providerId: personalProviderId, modelId: personalModelId },
  });
  const aiProviderId = connection.providerId;
  const aiModelId = connection.modelId;
  const updateSetting = (key: "aiProviderId" | "aiModelId", value: string) => {
    const state = useIntelligenceSettingsStore.getState();
    state.actions.change({
      ...state.preferences,
      tasks: {
        ...state.preferences.tasks,
        "inline-edit":
          key === "aiProviderId"
            ? { providerId: value, modelId: "" }
            : { providerId: aiProviderId, modelId: value },
      },
    });
    void state.actions.save();
  };
  const checkAllProviderApiKeys = useAIChatStore((state) => state.actions.checkAllProviderApiKeys);

  const getSelectionAnchorPosition = useCallback((): { line: number; column: number } | null => {
    if (!selection || selection.start.offset === selection.end.offset) return null;

    const start = selection.start.offset <= selection.end.offset ? selection.start : selection.end;
    const end = selection.start.offset <= selection.end.offset ? selection.end : selection.start;

    if (start.line === end.line) {
      return {
        line: start.line,
        column: Math.round((start.column + end.column) / 2),
      };
    }

    return {
      line: start.line,
      column: start.column,
    };
  }, [selection]);

  const defaultInlineEditSelectionAnchor = useMemo<InlineEditAnchor | null>(() => {
    if (!enabled || !inlineEditVisible) return null;

    const providedAnchor = getSelectionAnchorPosition() ?? getSelectionAnchor?.();
    if (providedAnchor) return providedAnchor;

    const cursorOffset =
      getCursorOffset?.() ?? (inputRef?.current ? inputRef.current.selectionStart : null);
    if (cursorOffset === null || cursorOffset === undefined) return null;

    const anchorPos = calculateCursorPositionFromLineOffsets(cursorOffset, lines, lineOffsets);
    return { line: anchorPos.line, column: anchorPos.column };
  }, [
    enabled,
    getCursorOffset,
    getSelectionAnchor,
    getSelectionAnchorPosition,
    inlineEditVisible,
    inputRef,
    lineOffsets,
    lines,
  ]);

  const inlineEditInstruction =
    inlineEditInstructionState.sessionKey === inlineEditSessionKey
      ? inlineEditInstructionState.value
      : "";
  const inlineEditProposal =
    proposalState.sessionKey === inlineEditSessionKey &&
    proposalState.value?.bufferId === buffer?.id
      ? proposalState.value
      : null;
  const rebasedProposalRange = useMemo(
    () =>
      inlineEditProposal && !inlineEditProposal.lost
        ? rebaseInlineEditRange(
            inlineEditProposal.baseContent,
            inlineEditContent,
            inlineEditProposal.startOffset,
            inlineEditProposal.endOffset,
          )
        : null,
    [inlineEditContent, inlineEditProposal],
  );
  const inlineEditProposalConflict = Boolean(inlineEditProposal && !rebasedProposalRange);

  useLayoutEffect(() => {
    if (!inlineEditProposal || inlineEditProposal.baseContent === inlineEditContent) return;
    const next: InlineEditProposal = rebasedProposalRange
      ? {
          ...inlineEditProposal,
          baseContent: inlineEditContent,
          startOffset: rebasedProposalRange.start,
          endOffset: rebasedProposalRange.end,
        }
      : { ...inlineEditProposal, baseContent: inlineEditContent, lost: true };
    setProposalState((current) =>
      current.value === inlineEditProposal ? { ...current, value: next } : current,
    );
  }, [inlineEditContent, inlineEditProposal, rebasedProposalRange]);
  const inlineEditError =
    (inlineEditErrorState.sessionKey === inlineEditSessionKey
      ? inlineEditErrorState.value
      : null) ?? (inlineEditProposalConflict ? CONFLICT_MESSAGE : null);
  const inlineEditSelectionAnchor =
    inlineEditSelectionAnchorState.sessionKey === inlineEditSessionKey
      ? inlineEditSelectionAnchorState.value
      : defaultInlineEditSelectionAnchor;

  const setInlineEditInstruction = useCallback(
    (nextValue: SetStateAction<string>) => {
      setInlineEditInstructionState((currentState) => {
        const currentValue =
          currentState.sessionKey === inlineEditSessionKey ? currentState.value : "";
        return {
          sessionKey: inlineEditSessionKey,
          value:
            typeof nextValue === "function"
              ? (nextValue as (currentValue: string) => string)(currentValue)
              : nextValue,
        };
      });
    },
    [inlineEditSessionKey],
  );

  const setInlineEditError = useCallback(
    (nextValue: SetStateAction<string | null>) => {
      setInlineEditErrorState((currentState) => {
        const currentValue =
          currentState.sessionKey === inlineEditSessionKey ? currentState.value : null;
        return {
          sessionKey: inlineEditSessionKey,
          value:
            typeof nextValue === "function"
              ? (nextValue as (currentValue: string | null) => string | null)(currentValue)
              : nextValue,
        };
      });
    },
    [inlineEditSessionKey],
  );

  const setInlineEditSelectionAnchor = useCallback(
    (nextValue: SetStateAction<InlineEditAnchor | null>) => {
      setInlineEditSelectionAnchorState((currentState) => {
        const currentValue =
          currentState.sessionKey === inlineEditSessionKey
            ? currentState.value
            : defaultInlineEditSelectionAnchor;
        return {
          sessionKey: inlineEditSessionKey,
          value:
            typeof nextValue === "function"
              ? (nextValue as (currentValue: InlineEditAnchor | null) => InlineEditAnchor | null)(
                  currentValue,
                )
              : nextValue,
        };
      });
    },
    [defaultInlineEditSelectionAnchor, inlineEditSessionKey],
  );

  useEffect(() => {
    if (!enabled || !inlineEditVisible) {
      const restoreTarget = focusRestoreRef.current;
      focusRestoreRef.current = null;
      if (restoreTarget && document.contains(restoreTarget)) {
        requestAnimationFrame(() => restoreTarget.focus());
      }
      return;
    }

    focusRestoreRef.current = document.activeElement as HTMLElement | null;

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
  }, [enabled, inlineEditVisible]);

  useEffect(() => {
    if (!enabled) return;
    if (!inlineEditVisible) return;
    void checkAllProviderApiKeys();
  }, [enabled, inlineEditVisible, checkAllProviderApiKeys]);

  const resolveInlineEditRange = useCallback((): Range | null => {
    if (!enabled) return null;

    if (selection && selection.start.offset !== selection.end.offset) {
      const start =
        selection.start.offset <= selection.end.offset ? selection.start : selection.end;
      const end = selection.start.offset <= selection.end.offset ? selection.end : selection.start;
      return { start, end };
    }

    if (lines.length === 0) {
      return null;
    }

    const cursorOffset =
      getCursorOffset?.() ?? (inputRef?.current ? inputRef.current.selectionStart : null);
    if (cursorOffset === null || cursorOffset === undefined) return null;

    const cursorPosition = calculateCursorPositionFromLineOffsets(cursorOffset, lines, lineOffsets);
    const lineText = lines[cursorPosition.line] ?? "";
    const lineStartOffset =
      lineOffsets[cursorPosition.line] ??
      calculateOffsetFromPosition(cursorPosition.line, 0, lines);
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
  }, [enabled, getCursorOffset, inputRef, lineOffsets, lines, selection]);

  const setInlineEditProposal = useCallback(
    (value: InlineEditProposal | null) => {
      setProposalState({ sessionKey: inlineEditSessionKey, value });
    },
    [inlineEditSessionKey],
  );

  /** The proposal last scrolled into view, so later rebuilds leave the viewport alone. */
  const revealedProposalRef = useRef<string | null>(null);
  useEffect(() => {
    if (!previewInlineEdit || !inlineEditProposal || !rebasedProposalRange) return;
    const proposalKey = [
      inlineEditProposal.bufferId,
      inlineEditProposal.instruction,
      inlineEditProposal.editedText,
    ].join("\0");
    const reveal = revealedProposalRef.current !== proposalKey;
    revealedProposalRef.current = proposalKey;
    return previewInlineEdit({
      startOffset: rebasedProposalRange.start,
      endOffset: rebasedProposalRange.end,
      editedText: inlineEditProposal.editedText,
      reveal,
    });
    // The content dependency rebuilds the preview when text around the proposal changes.
  }, [inlineEditContent, inlineEditProposal, previewInlineEdit, rebasedProposalRange]);

  const handleSubmitInlineEdit = useCallback(async () => {
    if (!inlineEditVisible || pendingRequestRef.current) return;
    if (!buffer) {
      toast.warning("Inline edit requires an open buffer.");
      inlineEditToolbarActions.hide();
      return;
    }

    const requestContent = buffer.content;
    const followUp = inlineEditInstruction.trim();
    let startOffset: number;
    let endOffset: number;
    let selectedText: string;
    let instruction: string;
    let proposalInstruction: string;

    if (inlineEditProposal) {
      if (!rebasedProposalRange) {
        setInlineEditProposal(null);
        setInlineEditError(CONFLICT_MESSAGE);
        return;
      }
      if (!followUp) return;
      startOffset = rebasedProposalRange.start;
      endOffset = rebasedProposalRange.end;
      selectedText = inlineEditProposal.editedText;
      instruction = composeInlineEditFollowUp(inlineEditProposal.instruction, followUp);
      proposalInstruction = `${inlineEditProposal.instruction}. Then: ${followUp}`;
    } else {
      const targetRange = resolveInlineEditRange();
      if (!targetRange) {
        toast.warning("Could not determine an inline edit target.");
        inlineEditToolbarActions.hide();
        return;
      }
      startOffset = targetRange.start.offset;
      endOffset = targetRange.end.offset;
      selectedText = requestContent.slice(startOffset, endOffset);
      instruction = followUp || DEFAULT_INLINE_EDIT_INSTRUCTION;
      proposalInstruction = instruction;
    }

    const provider = getProviderById(aiProviderId);

    if (!aiModelId.trim()) {
      setInlineEditError("Select an inline edit model.");
      return;
    }

    const scope = requestScopeRef.current;
    if (!scope) return;
    const request = { controller: new AbortController() };
    const trackedRange = { start: startOffset, end: endOffset, lost: false };
    scope.ranges.add(trackedRange);
    pendingRequestRef.current = request;
    const isCurrentRequest = () =>
      requestScopeRef.current === scope && pendingRequestRef.current === request;
    setInlineEditError(null);
    setIsInlineEditRunning(true);

    try {
      const enterprisePolicy = subscription?.enterprise?.policy;
      const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;

      const hasStoredProviderKey =
        useAIChatStore.getState().providerApiKeys.get(aiProviderId) || false;
      const canUseProvider =
        canUseIntelligenceProvider(aiProviderId, subscription) ||
        canUseProviderWithoutApiKey({
          providerId: aiProviderId,
          subscription,
          hasStoredKey: hasStoredProviderKey,
          requiresApiKey: provider?.requiresApiKey ?? true,
        });

      if (!canUseProvider) {
        await checkAllProviderApiKeys();
        if (!isCurrentRequest()) return;
        const hasProviderKeyAfterRefresh =
          useAIChatStore.getState().providerApiKeys.get(aiProviderId) || false;
        if (!hasProviderKeyAfterRefresh) {
          setInlineEditError(
            `${provider?.name ?? aiProviderId} API key is required for inline edit.`,
          );
          return;
        }
      }

      const hasProviderKey = useAIChatStore.getState().providerApiKeys.get(aiProviderId) || false;
      const useHosted = !hasProviderKey && canUseIntelligenceProvider(aiProviderId, subscription);

      if (useHosted && !isAuthenticated) {
        setInlineEditError("Sign in to use Athas Intelligence.");
        return;
      }

      if (useHosted && managedPolicy && !managedPolicy.aiCompletionEnabled) {
        setInlineEditError("Inline edit is disabled by your organization policy.");
        return;
      }

      if (!useHosted && managedPolicy && !managedPolicy.allowByok) {
        setInlineEditError("BYOK is disabled by your organization policy.");
        return;
      }

      const { editedText } = await requestInlineEdit(
        {
          provider: aiProviderId,
          feature: "inline-edit",
          model: aiModelId,
          beforeSelection: requestContent.slice(
            Math.max(0, startOffset - INLINE_EDIT_CONTEXT_CHARS),
            startOffset,
          ),
          selectedText,
          afterSelection: requestContent.slice(endOffset, endOffset + INLINE_EDIT_CONTEXT_CHARS),
          instruction,
          filePath: buffer.path,
          languageId: buffer.language,
        },
        { useHosted, signal: request.controller.signal, timeoutMs: INLINE_EDIT_TIMEOUT_MS },
      );

      if (!isCurrentRequest()) return;
      const latestContent = scope.content;
      const range = trackedRange.lost ? null : trackedRange;
      if (!range) {
        setInlineEditProposal(null);
        setInlineEditError(CONFLICT_MESSAGE);
        return;
      }

      if (!editedText.trim()) {
        setInlineEditError("Inline edit returned an empty result. Try a different instruction.");
        return;
      }

      setInlineEditProposal({
        bufferId: buffer.id,
        baseContent: latestContent,
        startOffset: range.start,
        endOffset: range.end,
        originalText: latestContent.slice(range.start, range.end),
        editedText,
        instruction: proposalInstruction,
      });
      setInlineEditInstruction("");
    } catch (error) {
      if (!isCurrentRequest() || request.controller.signal.aborted) return;
      setInlineEditError(
        error instanceof InlineEditError ? error.message : "Inline edit failed. Please try again.",
      );
    } finally {
      scope.ranges.delete(trackedRange);
      if (isCurrentRequest()) {
        pendingRequestRef.current = null;
        setIsInlineEditRunning(false);
      }
    }
  }, [
    buffer,
    inlineEditVisible,
    inlineEditProposal,
    rebasedProposalRange,
    resolveInlineEditRange,
    isAuthenticated,
    subscription,
    checkAllProviderApiKeys,
    aiProviderId,
    aiModelId,
    inlineEditInstruction,
    inlineEditToolbarActions,
    setInlineEditError,
    setInlineEditInstruction,
    setInlineEditProposal,
  ]);

  const cancelInlineEditRequest = useCallback(() => {
    const request = pendingRequestRef.current;
    if (!request) return false;
    request.controller.abort();
    pendingRequestRef.current = null;
    setIsInlineEditRunning(false);
    return true;
  }, []);

  const handleAcceptInlineEdit = useCallback(() => {
    if (!inlineEditVisible || pendingRequestRef.current || !buffer || !inlineEditProposal) return;
    if (!rebasedProposalRange) {
      setInlineEditError(CONFLICT_MESSAGE);
      return;
    }

    const { editedText } = inlineEditProposal;
    const { start: startOffset, end: endOffset } = rebasedProposalRange;
    const content = buffer.content;
    const range: Range = {
      start: { ...calculateCursorPositionFromContent(startOffset, content), offset: startOffset },
      end: { ...calculateCursorPositionFromContent(endOffset, content), offset: endOffset },
    };
    const newContent = `${content.slice(0, startOffset)}${editedText}${content.slice(endOffset)}`;
    const newCursorOffset = startOffset + editedText.length;
    const newPosition = calculateCursorPositionFromContent(newCursorOffset, newContent);

    setInlineEditProposal(null);
    if (applyInlineEdit) {
      applyInlineEdit({ range, editedText, newContent, newCursorOffset, newPosition });
    } else {
      updateBufferContent?.(buffer.id, newContent, true);
    }

    setCursorPosition(newPosition);
    setSelection(undefined);
    setInlineEditSelectionAnchor(null);
    inlineEditToolbarActions.hide();
    if (inputRef?.current) {
      inputRef.current.selectionStart = newCursorOffset;
      inputRef.current.selectionEnd = newCursorOffset;
    }
  }, [
    applyInlineEdit,
    buffer,
    inlineEditProposal,
    inlineEditToolbarActions,
    inlineEditVisible,
    inputRef,
    rebasedProposalRange,
    setCursorPosition,
    setInlineEditError,
    setInlineEditProposal,
    setInlineEditSelectionAnchor,
    setSelection,
    updateBufferContent,
  ]);

  const handleRejectInlineEdit = useCallback(() => {
    cancelInlineEditRequest();
    setInlineEditProposal(null);
    inlineEditToolbarActions.hide();
  }, [cancelInlineEditRequest, inlineEditToolbarActions, setInlineEditProposal]);

  /** Escape: stop a running request first, then discard the proposal and close. */
  const handleEscapeInlineEdit = useCallback(() => {
    if (cancelInlineEditRequest()) return;
    handleRejectInlineEdit();
  }, [cancelInlineEditRequest, handleRejectInlineEdit]);

  const popoverAnchor = (() => {
    if (!enabled) return null;
    if (!inlineEditVisible || !inlineEditSelectionAnchor) return null;
    if (inlineEditSelectionAnchor.line < 0 || inlineEditSelectionAnchor.line >= lines.length) {
      return null;
    }

    const lineText = lines[inlineEditSelectionAnchor.line] || "";
    const anchorColumn = Math.min(inlineEditSelectionAnchor.column, lineText.length);
    const resolvedAnchor = resolveModelPosition?.(inlineEditSelectionAnchor.line, anchorColumn);
    const anchorX =
      resolvedAnchor?.left !== undefined
        ? resolvedAnchor.left - EDITOR_CONSTANTS.EDITOR_PADDING_LEFT
        : getAccurateCursorX(lineText, anchorColumn, fontSize, fontFamily, tabSize);
    const anchorTop =
      resolvedAnchor?.top ??
      inlineEditSelectionAnchor.line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
    const viewportMetrics = getViewportMetrics?.();
    const textarea = inputRef?.current;
    const scrollLeft =
      viewportMetrics?.scrollLeft ?? textarea?.scrollLeft ?? lastScrollRef.current.left;
    const scrollTop =
      viewportMetrics?.scrollTop ?? textarea?.scrollTop ?? lastScrollRef.current.top;
    const viewportWidth = viewportMetrics?.viewportWidth ?? textarea?.clientWidth;

    const rawLeft = anchorX + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
    const left =
      viewportWidth === undefined
        ? rawLeft
        : Math.min(Math.max(rawLeft, scrollLeft), scrollLeft + viewportWidth);

    return {
      top: anchorTop,
      left,
      height: lineHeight,
      side:
        anchorTop - scrollTop < INLINE_EDIT_TOP_THRESHOLD ? ("bottom" as const) : ("top" as const),
    };
  })();

  return {
    inlineEditVisible,
    inlineEditInstruction,
    setInlineEditInstruction,
    inlineEditError,
    setInlineEditError,
    isInlineEditRunning,
    isInlineEditModelLoading: false,
    inlineEditModels: [],
    inlineEditSelectionAnchor,
    setInlineEditSelectionAnchor,
    inlineEditPopoverRef,
    inlineEditInstructionRef,
    inlineEditToolbarActions,
    inlineEditProposal,
    inlineEditProposalConflict,
    aiProviderId,
    aiModelId,
    updateSetting,
    handleSubmitInlineEdit,
    handleAcceptInlineEdit,
    handleRejectInlineEdit,
    handleEscapeInlineEdit,
    popoverAnchor,
  };
}
