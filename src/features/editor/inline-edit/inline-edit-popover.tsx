import { isComposingKeyboardEvent } from "@/utils/keyboard/is-composing-keyboard-event";
import { ArrowCornerDownLeftIcon, CheckIcon, XIcon } from "@/ui/icons";
import { type KeyboardEvent, useRef } from "react";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { Popover, PopoverListContent } from "@/ui/popover";
import { Spinner } from "@/ui/spinner";
import type { Range } from "@/features/editor/types/editor.types";
import type { useInlineEdit } from "./use-inline-edit";
import { ModelConnectionPicker } from "@/features/ai/components/selectors/model-connection-picker";

type InlineEditState = ReturnType<typeof useInlineEdit>;

interface InlineEditPopoverProps {
  state: InlineEditState;
  selection?: Range;
}

export function InlineEditPopover({ state, selection }: InlineEditPopoverProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  if (!state.inlineEditVisible || !state.popoverAnchor) return null;

  const proposal = state.inlineEditProposal;
  const running = state.isInlineEditRunning;
  const canAccept = Boolean(proposal) && !state.inlineEditProposalConflict && !running;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    // The model menu renders in a portal but its key events still bubble here; it owns them.
    if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
    if (isComposingKeyboardEvent(event.nativeEvent)) {
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      state.handleEscapeInlineEdit();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      if (canAccept) state.handleAcceptInlineEdit();
      return;
    }
    if (event.target instanceof HTMLInputElement) event.stopPropagation();
  };

  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden
        className="pointer-events-none absolute w-px opacity-0"
        style={{
          top: state.popoverAnchor.top,
          left: state.popoverAnchor.left,
          height: state.popoverAnchor.height,
        }}
      />
      <Popover open modal={false}>
        <PopoverListContent
          ref={state.inlineEditPopoverRef}
          anchor={anchorRef}
          side={state.popoverAnchor.side}
          align="start"
          size="panel"
          initialFocus={state.inlineEditInstructionRef}
          finalFocus={false}
          aria-labelledby="inline-edit-title"
          aria-describedby="inline-edit-description"
          onKeyDown={handleKeyDown}
        >
          <div className="sr-only">
            <div id="inline-edit-title">Inline edit</div>
            <div id="inline-edit-description">
              {proposal
                ? "Review the proposed change. Press Command or Control Enter to accept, Escape to reject, or type a follow-up and press Enter to refine it."
                : "Describe the code change, then press Enter to preview it or Escape to close."}
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1.5">
            <Input
              grow
              ref={state.inlineEditInstructionRef}
              autoFocus
              value={state.inlineEditInstruction}
              onChange={(event) => {
                state.setInlineEditInstruction(event.target.value);
                if (state.inlineEditError) {
                  state.setInlineEditError(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.defaultPrevented) return;
                if (isComposingKeyboardEvent(event.nativeEvent)) {
                  event.stopPropagation();
                  return;
                }
                if (
                  (event.metaKey || event.ctrlKey) &&
                  !event.altKey &&
                  event.key.toLowerCase() === "a"
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.select();
                  return;
                }
                if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault();
                  event.stopPropagation();
                  void state.handleSubmitInlineEdit();
                }
              }}
              variant="ghost"
              aria-label={proposal ? "Refine the proposed edit" : "Inline edit instruction"}
              aria-describedby={
                state.inlineEditError
                  ? "inline-edit-description inline-edit-error"
                  : "inline-edit-description"
              }
              aria-invalid={state.inlineEditError ? true : undefined}
              placeholder={
                proposal
                  ? "Refine, e.g. make it shorter..."
                  : selection && selection.start.offset !== selection.end.offset
                    ? "Edit selection..."
                    : "Edit current line..."
              }
            />
            <div className="min-w-0 max-w-40">
              <ModelConnectionPicker
                aria-label="Inline edit model"
                value={
                  state.aiProviderId
                    ? { providerId: state.aiProviderId, modelId: state.aiModelId }
                    : null
                }
                onChange={state.setInlineEditConnection}
                disabled={running}
              />
            </div>
            {running ? (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                onClick={() => state.handleEscapeInlineEdit()}
                tooltip="Stop inline edit"
                shortcut="escape"
              >
                <Spinner label="Generating edit" compact />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                onClick={() => void state.handleSubmitInlineEdit()}
                disabled={Boolean(proposal) && !state.inlineEditInstruction.trim()}
                tone="accent"
                tooltip={proposal ? "Refine proposed edit" : "Preview inline edit"}
                shortcut="enter"
              >
                <ArrowCornerDownLeftIcon />
              </Button>
            )}
            {proposal ? null : (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                onClick={() => state.handleRejectInlineEdit()}
                tooltip="Close inline edit"
                shortcut="escape"
              >
                <XIcon />
              </Button>
            )}
          </div>
          {proposal ? (
            <div className="flex items-center justify-end gap-1.5 px-2 pb-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => state.handleRejectInlineEdit()}
                tooltip="Reject proposed edit"
                shortcut="escape"
              >
                <XIcon />
                Reject
              </Button>
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={() => state.handleAcceptInlineEdit()}
                disabled={!canAccept}
                tooltip="Accept proposed edit"
                shortcut="mod+enter"
              >
                <CheckIcon />
                Accept
              </Button>
            </div>
          ) : null}
          {state.inlineEditError && (
            <Alert
              id="inline-edit-error"
              aria-live="assertive"
              tone="error"
              className="rounded-none border-x-0 border-b-0 py-1"
            >
              <AlertDescription>{state.inlineEditError}</AlertDescription>
            </Alert>
          )}
        </PopoverListContent>
      </Popover>
    </>
  );
}
