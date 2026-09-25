import { FileTextIcon, KeyIcon } from "@/ui/icons";
import type {
  AcpEvent,
  AcpPermissionOption,
  AcpPermissionPreview,
  AcpToolCallLocation,
} from "@/features/ai/types/acp.types";
import { createAcpDiffViewNode, toRelativeDisplayPath } from "@/features/ai/lib/acp-diff-output";
import {
  createAcpToolLocationTree,
  OPEN_TOOL_LOCATION_COMMAND,
} from "@/features/ai/lib/acp-tool-location-tree";
import { openToolPath } from "@/features/ai/lib/open-tool-location";
import { useProjectStore } from "@/features/window/stores/project.store";
import { ExtensionViewRenderer } from "@/extensions/ui/components/extension-view-renderer";
import Badge from "@/ui/badge";
import Textarea from "@/ui/textarea";
import { Button, type ButtonProps } from "@/ui/button";
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

function PreviewText({ label, text, mono }: { label: string; text: string; mono?: boolean }) {
  return (
    <pre
      aria-label={label}
      className={cn(
        "overflow-auto rounded-lg border border-border bg-surface px-2.5 py-2 whitespace-pre-wrap wrap-anywhere select-text text-foreground ui-text-sm",
        mono ? "font-mono" : "font-sans",
      )}
    >
      {text}
    </pre>
  );
}

function PreviewLocations({
  locations,
  rootFolderPath,
}: {
  locations: AcpToolCallLocation[];
  rootFolderPath?: string | null;
}) {
  const tree = createAcpToolLocationTree(locations);
  if (tree) {
    return (
      <ExtensionViewRenderer
        node={tree}
        execute={(action) => {
          const path = action.args?.[0];
          if (action.command === OPEN_TOOL_LOCATION_COMMAND && typeof path === "string") {
            return openToolPath(path);
          }
        }}
        surface="embedded"
      />
    );
  }
  const [location] = locations;
  if (!location) return null;
  const path = toRelativeDisplayPath(location.path, rootFolderPath);
  return (
    <div className="flex min-w-0">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        truncate
        tooltip="Open file"
        onClick={() => void openToolPath(location.path)}
      >
        <FileTextIcon />
        <span className="font-mono">{location.line ? `${path}:${location.line}` : path}</span>
      </Button>
    </div>
  );
}

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
  if (preview.type === "tool_call") {
    return (
      <div className="flex max-h-72 min-w-0 flex-col gap-1.5 overflow-y-auto">
        {preview.diffs.map((diff, index) => (
          <ExtensionViewRenderer
            key={`${diff.path}-${index}`}
            node={createAcpDiffViewNode(diff, rootFolderPath)}
            execute={() => undefined}
            surface="embedded"
          />
        ))}
        {preview.command ? (
          <PreviewText label="Proposed shell command" text={preview.command} mono />
        ) : null}
        {preview.text ? <PreviewText label="Tool call details" text={preview.text} /> : null}
        {preview.inputSummary ? (
          <PreviewText label="Tool call input" text={preview.inputSummary} mono />
        ) : null}
        {preview.locations.length > 0 ? (
          <PreviewLocations locations={preview.locations} rootFolderPath={rootFolderPath} />
        ) : null}
      </div>
    );
  }
  return (
    <pre
      aria-label="Proposed shell command"
      className="max-h-48 overflow-auto rounded-lg border border-border bg-surface px-2.5 py-2 font-mono whitespace-pre-wrap wrap-anywhere select-text text-foreground ui-text-sm"
    >
      {preview.command}
    </pre>
  );
}

function getPreviewSummary(
  preview: AcpPermissionPreview,
  rootFolderPath?: string | null,
): string | undefined {
  if (preview.type === "tool_call") {
    return preview.title ?? undefined;
  }
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

function getOptionStyle(
  option: AcpPermissionOption,
): Partial<Pick<ButtonProps, "variant" | "tone">> {
  switch (option.kind) {
    case "allow_always":
      return { variant: "accent" };
    case "allow_once":
      return { variant: "default" };
    case "reject_always":
    case "reject_once":
      return { variant: "ghost", tone: "danger" };
    default:
      return { variant: "ghost" };
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
    (permission.preview && getPreviewSummary(permission.preview, rootFolderPath)) ||
    permission.description ||
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-border bg-background px-2 py-1.5 shadow-(--shadow-card)">
        <KeyIcon className="size-3.5 shrink-0 text-subtle-foreground" />
        <div
          className="flex min-w-0 flex-1 basis-40 items-center text-foreground"
          title={`${permission.permissionType} - ${permission.resource}`}
        >
          <span className="shrink-0 font-medium text-muted-foreground">Permission</span>
          <span className="shrink-0 px-1.5 text-subtle-foreground">/</span>
          <span className="min-w-0 truncate font-mono">{summary}</span>
        </div>
        {queuedCount > 0 ? <Badge>+{queuedCount}</Badge> : null}
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
          {options.map((option) => {
            return (
              <Button
                key={option.id}
                type="button"
                {...getOptionStyle(option)}
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
