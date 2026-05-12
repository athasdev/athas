import { ArrowBendDownLeft as CornerDownLeft, X } from "@phosphor-icons/react";
import { forwardRef } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { EDITOR_CONSTANTS } from "../config/constants";
import type { useInlineEdit } from "../hooks/use-inline-edit";
import type { Range } from "../types/editor";
import { InlineEditModelSelector } from "./inline-edit-model-selector";

type InlineEditState = ReturnType<typeof useInlineEdit>;

interface InlineEditPopoverProps {
  state: InlineEditState;
  selection?: Range;
  zoneTop?: number;
}

export const InlineEditPopover = forwardRef<HTMLDivElement, InlineEditPopoverProps>(
  function InlineEditPopover({ state, selection, zoneTop }, ref) {
    if (!state.inlineEditVisible || !state.popoverPosition) return null;

    return (
      <div ref={ref} className="pointer-events-none absolute inset-0 z-[200]">
        <div
          ref={state.inlineEditPopoverRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="inline-edit-title"
          aria-describedby="inline-edit-description"
          className="pointer-events-auto absolute right-4 max-w-[720px] overflow-hidden rounded-md border border-border/60 bg-primary-bg shadow-lg"
          style={{
            top: `${zoneTop ?? state.popoverPosition.top}px`,
            left: `${EDITOR_CONSTANTS.EDITOR_PADDING_LEFT}px`,
          }}
        >
          <div className="px-2 py-1.5">
            <div className="sr-only">
              <div id="inline-edit-title">Inline edit</div>
              <div id="inline-edit-description">
                Describe the code change, then press Enter to apply or Escape to close.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
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
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void state.handleApplyInlineEdit();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    if (!state.isInlineEditRunning) {
                      state.inlineEditToolbarActions.hide();
                    }
                  }
                }}
                variant="ghost"
                size="sm"
                aria-label="Inline edit instruction"
                aria-describedby={
                  state.inlineEditError
                    ? "inline-edit-description inline-edit-error"
                    : "inline-edit-description"
                }
                aria-invalid={state.inlineEditError ? true : undefined}
                className="ui-font h-8 flex-1 bg-transparent px-0 ui-text-xs placeholder:text-text-lighter/80 focus:bg-transparent"
                placeholder={
                  selection && selection.start.offset !== selection.end.offset
                    ? "Describe the edit for the selection..."
                    : "Describe the edit for the current line..."
                }
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => state.inlineEditToolbarActions.hide()}
                className="text-text-lighter hover:text-text"
                tooltip="Close inline edit"
                shortcut="escape"
              >
                <X />
              </Button>
            </div>
            {state.inlineEditError && (
              <div
                id="inline-edit-error"
                role="alert"
                aria-live="assertive"
                className="ui-font mt-1.5 rounded-md bg-red-500/10 px-2 py-1.5 ui-text-xs text-red-300"
              >
                {state.inlineEditError}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-2 py-1">
            <div className="min-w-0 flex-1">
              <InlineEditModelSelector
                models={state.inlineEditModels}
                value={state.aiAutocompleteModelId}
                onChange={(modelId) => state.updateSetting("aiAutocompleteModelId", modelId)}
                disabled={state.isInlineEditRunning}
                isLoading={state.isInlineEditModelLoading}
              />
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void state.handleApplyInlineEdit()}
                disabled={state.isInlineEditRunning}
                className="gap-1 px-1 text-accent hover:bg-transparent hover:text-accent/80"
                aria-label={
                  state.isInlineEditRunning ? "Applying inline edit" : "Apply inline edit"
                }
                tooltip="Apply inline edit"
                shortcut="enter"
              >
                <CornerDownLeft />
                {state.isInlineEditRunning ? "Applying..." : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
