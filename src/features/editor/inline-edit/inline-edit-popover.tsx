import { ArrowBendDownLeftIcon as CornerDownLeft, XIcon as X } from "@/ui/icons";
import { forwardRef } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import type { Range } from "@/features/editor/types/editor.types";
import type { useInlineEdit } from "./use-inline-edit";
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
          className="pointer-events-auto absolute overflow-hidden rounded-md border border-border/70 bg-primary-bg shadow-[var(--shadow-popover)]"
          style={{
            top: `${zoneTop ?? state.popoverPosition.top}px`,
            left: `${state.popoverPosition.left}px`,
            width: "min(380px, calc(100% - 16px))",
          }}
        >
          <div className="sr-only">
            <div id="inline-edit-title">Inline edit</div>
            <div id="inline-edit-description">
              Describe the code change, then press Enter to apply or Escape to close.
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1.5">
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

                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  void state.handleApplyInlineEdit();
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!state.isInlineEditRunning) {
                    state.inlineEditToolbarActions.hide();
                  }
                  return;
                }

                event.stopPropagation();
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
              className="font-sans h-7 min-w-0 flex-1 bg-transparent px-0 ui-text-sm placeholder:text-text-lighter/80 focus:bg-transparent"
              placeholder={
                selection && selection.start.offset !== selection.end.offset
                  ? "Edit selection..."
                  : "Edit current line..."
              }
            />
            <div className="min-w-0 shrink-0">
              <InlineEditModelSelector
                providerId={state.aiProviderId}
                modelId={state.aiModelId}
                onProviderChange={(providerId) => state.updateSetting("aiProviderId", providerId)}
                onModelChange={(modelId) => state.updateSetting("aiModelId", modelId)}
                disabled={state.isInlineEditRunning}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void state.handleApplyInlineEdit()}
              disabled={state.isInlineEditRunning}
              className="text-accent hover:bg-transparent hover:text-accent/80"
              aria-label={state.isInlineEditRunning ? "Applying inline edit" : "Apply inline edit"}
              tooltip="Apply inline edit"
              shortcut="enter"
            >
              <CornerDownLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
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
              className="font-sans border-t border-border/50 bg-error/10 px-2 py-1 ui-text-sm text-error"
            >
              {state.inlineEditError}
            </div>
          )}
        </div>
      </div>
    );
  },
);
