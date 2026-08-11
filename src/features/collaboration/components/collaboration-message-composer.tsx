import { FilePlusIcon as FilePlus, PaperPlaneTiltIcon as PaperPlaneTilt } from "@/ui/icons";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
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
    <SidebarFooter>
      {error ? (
        <Alert tone="error" className="mb-1.5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <SidebarComposerBody variant="plain">
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
          className="max-h-24 min-h-12 resize-none"
        />
      </SidebarComposerBody>
      <div className="mt-1 flex items-center justify-between gap-2 px-1 pb-1">
        {canShareDocuments ? (
          <Button
            type="button"
            variant="ghost"
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
          disabled={isSubmitDisabled}
          tooltip={isSending ? "Sending" : "Send"}
          tooltipSide="top"
          onClick={onSubmit}
          size="icon-xs"
        >
          {isSending ? <Spinner label="Sending" compact /> : <PaperPlaneTilt />}
        </Button>
      </div>
    </SidebarFooter>
  );
}
