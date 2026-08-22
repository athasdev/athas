import { useEffect, useState, type FormEvent } from "react";
import type { AdminDataSource } from "@/features/admin-data/types/admin-data.types";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import Input from "@/ui/input";

interface AdminDataSourceDialogProps {
  source?: AdminDataSource;
  onClose: () => void;
  onSave: (source: AdminDataSource) => Promise<void>;
}

function isGitHubApiUrl(value: string): boolean {
  try {
    return new URL(value).hostname === "api.github.com";
  } catch {
    return false;
  }
}

export function AdminDataSourceDialog({ source, onClose, onSave }: AdminDataSourceDialogProps) {
  const [name, setName] = useState(source?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [rowsPath, setRowsPath] = useState(source?.rowsPath ?? "");
  const [useGitHubAccount, setUseGitHubAccount] = useState(source?.authentication === "github");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canUseGitHubAccount = isGitHubApiUrl(url);

  useEffect(() => {
    if (!canUseGitHubAccount) setUseGitHubAccount(false);
  }, [canUseGitHubAccount]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();

    if (!trimmedName || !trimmedUrl) {
      setError("Name and JSON URL are required");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        id: source?.id ?? crypto.randomUUID(),
        name: trimmedName,
        url: trimmedUrl,
        rowsPath: rowsPath.trim(),
        authentication: useGitHubAccount ? "github" : "none",
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not load this source");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogContent aria-describedby="admin-data-source-description" size="md" className="p-0">
      <DialogHeader>
        <DialogTitle>{source ? "Edit Data Source" : "Add Data Source"}</DialogTitle>
        <DialogDescription id="admin-data-source-description">
          Load a JSON endpoint into the project&apos;s table viewer.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <div className="flex flex-col gap-3 px-4 py-4">
          <label className="flex flex-col gap-1.5 font-sans ui-text-sm text-foreground">
            Name
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Release downloads"
            />
          </label>
          <label className="flex flex-col gap-1.5 font-sans ui-text-sm text-foreground">
            JSON URL
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://api.github.com/repos/owner/repo/releases"
            />
          </label>
          <label className="flex flex-col gap-1.5 font-sans ui-text-sm text-foreground">
            Rows path
            <Input
              value={rowsPath}
              onChange={(event) => setRowsPath(event.target.value)}
              placeholder="assets[]"
            />
            <span className="text-subtle-foreground">
              Optional. Use dot paths and [] to expand arrays, such as data.items or assets[].
            </span>
          </label>
          {canUseGitHubAccount ? (
            <label className="flex items-center gap-2 font-sans ui-text-sm text-foreground">
              <Checkbox checked={useGitHubAccount} onCheckedChange={setUseGitHubAccount} />
              Use connected GitHub account
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="font-sans ui-text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" size="sm" disabled={isSaving}>
            {isSaving ? "Testing source..." : source ? "Save Source" : "Add Source"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
