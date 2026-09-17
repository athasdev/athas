import { KeyIcon } from "@/ui/icons";
import type {
  AcpEvent,
  AcpPermissionOption,
  AcpPermissionPreview,
} from "@/features/ai/types/acp.types";
import { createAcpDiffViewNode, toRelativeDisplayPath } from "@/features/ai/lib/acp-diff-output";
import { useProjectStore } from "@/features/window/stores/project.store";
import { ExtensionViewRenderer } from "@/extensions/ui/components/extension-view-renderer";
import Badge from "@/ui/badge";
import Textarea from "@/ui/textarea";
import { Button, type ButtonVariant } from "@/ui/button";
import { cn } from "@/utils/cn";
import { chatContentWidth } from "./chat-content-width";

export type AcpPermissionRequest = {
  requestId: string;
  description: string;
  permissionType: string;
  resource: string;
  options: Extract<AcpEvent, { type: "permission_request" }>["options"];
  preview?: AcpPermissionPreview;
};

function PermissionPreview({ preview }: { preview: AcpPermissionPreview }) {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  if (preview.type === "diff") {
    return (
      <ExtensionViewRenderer
        node={createAcpDiffViewNode(preview, rootFolderPath)}
        execute={() => undefined}
        surface="embedded"
      />
    );
  }
  return (
    <pre
      aria-label="Proposed shell command"
      className="max-h-48 overflow-auto rounded-lg border border-border/70 bg-surface/45 px-2.5 py-2 font-mono whitespace-pre-wrap wrap-anywhere select-text text-foreground ui-text-sm"
    >
      {preview.command}
    </pre>
  );
}

function getPreviewSummary(preview: AcpPermissionPreview, rootFolderPath?: string | null) {
  if (preview.type === "diff") {
    const isNew = preview.oldText.length === 0;
    return `${isNew ? "Create" : "Edit"} ${toRelativeDisplayPath(preview.path, rootFolderPath)}`;
  }
  return `Run ${preview.command.trim().split("\n")[0] ?? ""}`;
}

const fallbackOptions: AcpPermissionOption[] = [
  { id: "reject", name: "Deny", kind: "reject_once" },
  { id: "allow", name: "Allow", kind: "allow_once" },
];

function getOptionLabel(option: AcpPermissionOption) {
  switch (option.kind) {
    case "allow_once":
      return "Allow";
    case "allow_always":
      return "Always";
    case "reject_once":
      return "Deny";
    case "reject_always":
      return "Never";
    default:
      return option.name;
  }
}

function getOptionTooltip(option: AcpPermissionOption) {
  switch (option.kind) {
    case "allow_once":
      return "Allow once";
    case "allow_always":
      return "Always allow this request type";
    case "reject_once":
      return "Deny once";
    case "reject_always":
      return "Always deny this request type";
    default:
      return option.name;
  }
}

function getOptionVariant(option: AcpPermissionOption): ButtonVariant {
  switch (option.kind) {
    case "allow_always":
      return "accent";
    case "allow_once":
      return "default";
    case "reject_always":
    case "reject_once":
      return "danger";
    default:
      return "ghost";
  }
}

function isApproval(option: AcpPermissionOption) {
  return option.kind === "allow_once" || option.kind === "allow_always";
}

export function AcpPermissionPrompt({
  permission,
  queuedCount,
  onRespond,
}: {
  permission: AcpPermissionRequest;
  queuedCount: number;
  onRespond: (approved: boolean, optionId?: string) => void;
}) {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const summary = (
    permission.preview
      ? getPreviewSummary(permission.preview, rootFolderPath)
      : permission.description ||
        [permission.permissionType, permission.resource].filter(Boolean).join(" ")
  ).trim();
  const options = permission.options.length > 0 ? permission.options : fallbackOptions;

  return (
    <div className={cn(chatContentWidth(), "mb-1 flex flex-col gap-1.5 ui-text-sm")}>
      {permission.preview ? (
        <PermissionPreview preview={permission.preview} />
      ) : permission.requestId.startsWith("intelligence:") ? (
        <Textarea
          aria-label={
            permission.permissionType === "intelligence-command"
              ? "Proposed shell command"
              : "Proposed workspace edit"
          }
          readOnly
          font="mono"
          resize="y"
          rows={12}
          value={permission.description}
        />
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-border/70 bg-background/92 px-2 py-1.5 shadow-(--shadow-card)">
        <KeyIcon className="size-3.5 shrink-0 text-subtle-foreground" />
        <div
          className="flex min-w-0 flex-1 basis-40 items-center text-foreground"
          title={`${permission.permissionType} - ${permission.resource}`}
        >
          <span className="shrink-0 font-medium text-muted-foreground">Permission</span>
          <span className="shrink-0 px-1.5 text-subtle-foreground">/</span>
          <span className="min-w-0 truncate font-mono">{summary}</span>
        </div>
        {queuedCount > 0 ? <Badge variant="muted">+{queuedCount}</Badge> : null}
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
          {options.map((option) => {
            return (
              <Button
                key={option.id}
                type="button"
                variant={getOptionVariant(option)}
                onClick={() =>
                  onRespond(
                    isApproval(option),
                    permission.options.length > 0 ? option.id : undefined,
                  )
                }
                tooltip={getOptionTooltip(option)}
              >
                {getOptionLabel(option)}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
