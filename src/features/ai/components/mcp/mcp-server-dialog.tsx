import { useState } from "react";
import {
  hasMcpServerDraftErrors,
  MCP_TRANSPORT_LABELS,
  validateMcpServerDraft,
} from "@/features/ai/lib/mcp-servers";
import type {
  McpNameValue,
  McpServerDraft,
  McpServerDraftErrors,
  McpServerSetting,
  McpTransport,
} from "@/features/ai/types/mcp-server.types";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/ui/field";
import { PlugsConnectedIcon, PlusIcon, TrashIcon } from "@/ui/icons";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";
import { ToggleGroup } from "@/ui/toggle-group";

interface McpServerDialogProps {
  initialDraft: McpServerDraft;
  servers: readonly McpServerSetting[];
  onClose: () => void;
  onSave: (draft: McpServerDraft) => Promise<void>;
}

const TRANSPORT_OPTIONS = (Object.keys(MCP_TRANSPORT_LABELS) as McpTransport[]).map((value) => ({
  value,
  label: MCP_TRANSPORT_LABELS[value],
}));

export function McpServerDialog({ initialDraft, servers, onClose, onSave }: McpServerDialogProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<McpServerDraftErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const isStdio = draft.transport === "stdio";

  const update = (changes: Partial<McpServerDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  };

  const handleSave = async () => {
    const nextErrors = validateMcpServerDraft(draft, servers);
    setErrors(nextErrors);
    if (hasMcpServerDraftErrors(nextErrors)) return;

    setIsSaving(true);
    try {
      await onSave(draft);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      title={draft.id ? "Edit MCP server" : "Add MCP server"}
      icon={PlugsConnectedIcon}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {draft.id ? "Save changes" : "Add server"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="mcp-server-name">Name</FieldLabel>
          <Input
            id="mcp-server-name"
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="linear"
            aria-invalid={errors.name ? true : undefined}
            autoFocus
          />
          <FieldError>{errors.name}</FieldError>
        </Field>

        <Field>
          <FieldLabel>Transport</FieldLabel>
          <ToggleGroup
            value={draft.transport}
            onValueChange={(value) => update({ transport: value as McpTransport })}
            ariaLabel="MCP server transport"
            options={TRANSPORT_OPTIONS}
          />
          <FieldDescription>
            Every agent can run stdio servers. HTTP and SSE servers are only passed to agents that
            support them.
          </FieldDescription>
        </Field>

        {isStdio ? (
          <>
            <Field>
              <FieldLabel htmlFor="mcp-server-command">Command</FieldLabel>
              <Input
                id="mcp-server-command"
                value={draft.command}
                onChange={(event) => update({ command: event.target.value })}
                placeholder="npx"
                font="mono"
                spellCheck={false}
                aria-invalid={errors.command ? true : undefined}
              />
              <FieldError>{errors.command}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="mcp-server-args">Arguments</FieldLabel>
              <Textarea
                id="mcp-server-args"
                value={draft.argsText}
                onChange={(event) => update({ argsText: event.target.value })}
                placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
                font="mono"
                rows={3}
                spellCheck={false}
              />
              <FieldDescription>One argument per line.</FieldDescription>
            </Field>
            <NameValueList
              label="Environment variables"
              addLabel="Add variable"
              namePlaceholder="API_KEY"
              values={draft.env}
              error={errors.env}
              onChange={(env) => update({ env })}
            />
          </>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="mcp-server-url">URL</FieldLabel>
              <Input
                id="mcp-server-url"
                value={draft.url}
                onChange={(event) => update({ url: event.target.value })}
                placeholder="https://mcp.example.com/mcp"
                font="mono"
                spellCheck={false}
                aria-invalid={errors.url ? true : undefined}
              />
              <FieldError>{errors.url}</FieldError>
            </Field>
            <NameValueList
              label="Headers"
              addLabel="Add header"
              namePlaceholder="Authorization"
              values={draft.headers}
              error={errors.headers}
              onChange={(headers) => update({ headers })}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

interface NameValueListProps {
  label: string;
  addLabel: string;
  namePlaceholder: string;
  values: McpNameValue[];
  error?: string;
  onChange: (values: McpNameValue[]) => void;
}

function NameValueList({
  label,
  addLabel,
  namePlaceholder,
  values,
  error,
  onChange,
}: NameValueListProps) {
  const updateAt = (index: number, changes: Partial<McpNameValue>) => {
    onChange(values.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)));
  };

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {values.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={entry.name}
            onChange={(event) => updateAt(index, { name: event.target.value })}
            placeholder={namePlaceholder}
            aria-label={`${label} name ${index + 1}`}
            font="mono"
            spellCheck={false}
          />
          <Input
            type="password"
            value={entry.value}
            onChange={(event) => updateAt(index, { value: event.target.value })}
            placeholder="Value"
            aria-label={`${label} value ${index + 1}`}
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="ghost"
            tone="danger"
            iconOnly
            tooltip="Remove"
            aria-label={`Remove ${entry.name || label.toLowerCase()}`}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            <TrashIcon />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onChange([...values, { name: "", value: "" }])}
        >
          <PlusIcon />
          {addLabel}
        </Button>
      </div>
      <FieldDescription>Values are stored securely, not in settings.</FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
