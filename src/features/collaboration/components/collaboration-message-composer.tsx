import { FilePlusIcon as FilePlus, PaperPlaneTiltIcon as PaperPlaneTilt } from "@/ui/icons";
import { chatComposerIconButtonClassName } from "@/features/ai/components/input/chat-composer-control-styles";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import { SidebarComposerBody, SidebarFooter } from "@/ui/sidebar";
import Textarea from "@/ui/textarea";

export function CollaborationMessageComposer({
  value,
  placeholder,
  error,
  disabled,
  isSending,
  canShareDocuments = false,
  onChange,
  onSubmit,
  onShareDocuments,
}: {
  value: string;
  placeholder: string;
  error: string | null;
  disabled: boolean;
  isSending: boolean;
  canShareDocuments?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onShareDocuments?: () => void;
}) {
  const isSubmitDisabled = !value.trim() || disabled || isSending;

  return (
    <SidebarFooter surface className="mx-0 mb-0">
      {error ? <div className="ui-text-sm mb-1.5 px-1 text-error">{error}</div> : null}
      <SidebarComposerBody className="border-0">
        <Textarea
          value={value}
          variant="ghost"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          disabled={disabled || isSending}
          className="ui-text-sm max-h-24 min-h-12 resize-none px-2 py-1.5 leading-5"
        />
      </SidebarComposerBody>
      <div className="mt-1 flex items-center justify-between gap-2 px-1 pb-1">
        {canShareDocuments ? (
          <Button
            type="button"
            variant="ghost"
            className={chatComposerIconButtonClassName()}
            disabled={disabled || isSending}
            tooltip="Share Documents"
            tooltipSide="top"
            onClick={onShareDocuments}
            size="icon-sm"
          >
            <FilePlus />
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="accent"
          className="rounded-md [&_svg]:size-3.5"
          disabled={isSubmitDisabled}
          tooltip={isSending ? "Sending" : "Send"}
          tooltipSide="top"
          onClick={onSubmit}
          size="icon-xs"
        >
          {isSending ? <LoadingIndicator label="Sending" compact /> : <PaperPlaneTilt />}
        </Button>
      </div>
    </SidebarFooter>
  );
}
