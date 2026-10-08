import { isComposingKeyboardEvent } from "@/utils/keyboard/is-composing-keyboard-event";
import { CheckIcon, MagicWandIcon, XIcon } from "@/ui/icons";
import { type CSSProperties, type KeyboardEvent, useRef } from "react";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Keybinding from "@/ui/keybinding";
import { Popover, PopoverListContent } from "@/ui/popover";
import { Spinner } from "@/ui/spinner";
import type { Range } from "@/features/editor/types/editor.types";
import type { useInlineEdit } from "../hooks/use-inline-edit";
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
        className="pointer-events-none absolute top-(--inline-edit-anchor-top) left-(--inline-edit-anchor-left) h-(--inline-edit-anchor-height) w-px opacity-0"
        style={
          {
            "--inline-edit-anchor-top": `${state.popoverAnchor.top}px`,
            "--inline-edit-anchor-left": `${state.popoverAnchor.left}px`,
            "--inline-edit-anchor-height": `${state.popoverAnchor.height}px`,
          } as CSSProperties
        }
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
          <div className="flex items-center gap-1.5 px-2 pt-1.5">
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
            <Button
              type="button"
              variant="ghost"
              iconOnly
              onClick={() =>
                running ? state.handleEscapeInlineEdit() : state.handleRejectInlineEdit()
              }
              tooltip={
                running
                  ? "Stop inline edit"
                  : proposal
                    ? "Reject proposed edit"
                    : "Close inline edit"
              }
              shortcut="escape"
            >
              <XIcon />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-1.5 px-2 pb-1.5">
            <div className="min-w-0">
              <ModelConnectionPicker
                appearance="subtle"
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
            <div className="flex shrink-0 items-center gap-1">
              {running ? (
                <span className="flex h-chrome-control items-center gap-1.5 px-2 ui-text-chrome text-muted-foreground">
                  <Spinner label="Generating edit" compact />
                  Generating
                </span>
              ) : proposal ? (
                <>
                  {state.inlineEditInstruction.trim() ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void state.handleSubmitInlineEdit()}
                    >
                      Refine
                      <Keybinding binding="enter" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="accent"
                    size="sm"
                    onClick={() => state.handleAcceptInlineEdit()}
                    disabled={!canAccept}
                  >
                    <CheckIcon />
                    Accept
                    <Keybinding binding="mod+enter" />
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void state.handleSubmitInlineEdit()}
                  disabled={!state.inlineEditInstruction.trim()}
                >
                  <MagicWandIcon />
                  Preview edit
                  <Keybinding binding="enter" />
                </Button>
              )}
            </div>
          </div>
          {state.inlineEditError && (
            <Alert id="inline-edit-error" aria-live="assertive" tone="error" variant="banner">
              <AlertDescription>{state.inlineEditError}</AlertDescription>
            </Alert>
          )}
        </PopoverListContent>
      </Popover>
    </>
  );
}
