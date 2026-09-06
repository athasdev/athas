import { useState } from "react";
import Dialog from "@/ui/dialog";
import Select from "@/ui/select";
import Input from "@/ui/input";
import { Button } from "@/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import { updateShare } from "../services/share-api";
import type { SharedItem, ShareInput, ShareOptions } from "../types/share.types";

export function ShareAccessDialog({
  item,
  options,
  onClose,
  onSaved,
}: {
  item: SharedItem;
  options: ShareOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [visibility, setVisibility] = useState(item.visibility as ShareInput["visibility"]);
  const [emails, setEmails] = useState(item.emails.join(", "));
  const [workspaceId, setWorkspaceId] = useState(String(item.workspaceId || ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await updateShare(item.id, item.revision, {
        visibility,
        emails: emails.split(/[,;\s]+/).filter(Boolean),
        workspaceId: workspaceId ? Number(workspaceId) : null,
      });
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update access");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Manage access"
      onClose={onClose}
      footer={
        <Button
          disabled={busy || (visibility !== "public" && !options.pro)}
          onClick={() => void save()}
        >
          Save access
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="ui-text-sm font-medium">{item.title}</p>
        <Field>
          <FieldLabel>Who can open this link</FieldLabel>
          <Select
            width="full"
            aria-label="Visibility"
            value={visibility}
            onChange={(value) => setVisibility(value as ShareInput["visibility"])}
            options={[
              { value: "public", label: "Anyone with the link" },
              { value: "email", label: "Specific emails · Pro" },
              { value: "organization", label: "Organization · Pro" },
            ]}
          />
        </Field>
        {visibility === "email" && (
          <Field>
            <FieldLabel htmlFor="access-emails">Allowed emails</FieldLabel>
            <Input
              id="access-emails"
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
            />
          </Field>
        )}
        {visibility === "organization" && (
          <Field>
            <FieldLabel>Organization</FieldLabel>
            <Select
              width="full"
              aria-label="Organization"
              value={workspaceId}
              onChange={setWorkspaceId}
              options={options.organizations.map((organization) => ({
                value: String(organization.id),
                label: organization.name,
              }))}
            />
          </Field>
        )}
        {visibility !== "public" && !options.pro && (
          <FieldDescription>Email and organization access require Athas Pro.</FieldDescription>
        )}
        {error && (
          <p role="alert" className="ui-text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
