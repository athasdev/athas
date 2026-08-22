import { useEffect, useState, type FormEvent } from "react";
import {
  resolveProjectGitHubRepository,
  type GitHubRepository,
} from "@/features/admin-data/lib/admin-data-github";
import {
  planAdminDataSourceWithIntelligence,
  planKnownGitHubSource,
} from "@/features/admin-data/services/admin-data-intelligence";
import type { AdminDataSource } from "@/features/admin-data/types/admin-data.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { useAuthStore } from "@/features/window/stores/auth.store";
import Badge from "@/ui/badge";
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
import { GithubLogoIcon, SparkleIcon } from "@/ui/icons";
import Select from "@/ui/select";
import Textarea from "@/ui/textarea";

interface AdminDataSourceDialogProps {
  projectPath: string;
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

export function AdminDataSourceDialog({
  projectPath,
  source,
  onClose,
  onSave,
}: AdminDataSourceDialogProps) {
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const hasIntelligence = hasProductCapability(subscription, "intelligence");
  const [mode, setMode] = useState<"intelligence" | "manual">(source ? "manual" : "intelligence");
  const [request, setRequest] = useState("");
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const [isResolvingRepository, setIsResolvingRepository] = useState(true);
  const [kind, setKind] = useState<AdminDataSource["kind"]>(source?.kind ?? "github");
  const [name, setName] = useState(source?.name ?? "");
  const [location, setLocation] = useState(
    source?.kind === "github" ? source.endpointPath : (source?.url ?? ""),
  );
  const [rowsPath, setRowsPath] = useState(source?.rowsPath ?? "");
  const [useGitHubAccount, setUseGitHubAccount] = useState(
    source?.kind === "json" && source.authentication === "github",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canUseGitHubAccount = kind === "json" && isGitHubApiUrl(location);

  useEffect(() => {
    let cancelled = false;
    setIsResolvingRepository(true);

    void resolveProjectGitHubRepository(projectPath).then((nextRepository) => {
      if (!cancelled) {
        setRepository(nextRepository);
        setIsResolvingRepository(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    if (!canUseGitHubAccount) setUseGitHubAccount(false);
  }, [canUseGitHubAccount]);

  const handleIntelligenceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedRequest = request.trim();
    if (!trimmedRequest) {
      setError("Describe the data you want to see");
      return;
    }
    if (!repository) {
      setError("This project does not have a GitHub remote. Configure the source manually.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      let plannedSource: AdminDataSource | null = null;
      let intelligenceError: unknown = null;

      if (isAuthenticated && hasIntelligence) {
        try {
          plannedSource = await planAdminDataSourceWithIntelligence({
            request: trimmedRequest,
            repository,
            model: aiAutocompleteModelId,
          });
        } catch (nextError) {
          intelligenceError = nextError;
        }
      }

      plannedSource ??= planKnownGitHubSource(trimmedRequest);
      if (!plannedSource) {
        throw (
          intelligenceError ??
          new Error("This request needs manual configuration. Choose Configure manually.")
        );
      }

      await onSave(plannedSource);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not create this source");
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedLocation = location.trim();

    if (!trimmedName || !trimmedLocation) {
      setError("Name and source location are required");
      return;
    }
    if (kind === "github" && !repository) {
      setError("This project does not have a GitHub remote");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const base = {
        id: source?.id ?? crypto.randomUUID(),
        name: trimmedName,
        rowsPath: rowsPath.trim(),
      };
      const nextSource: AdminDataSource =
        kind === "github"
          ? { ...base, kind, endpointPath: trimmedLocation }
          : {
              ...base,
              kind,
              url: trimmedLocation,
              authentication: useGitHubAccount ? "github" : "none",
            };

      await onSave(nextSource);
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
          {mode === "intelligence"
            ? "Describe the project data you want. Athas will configure the source."
            : "Configure the source only when automatic setup is not enough."}
        </DialogDescription>
      </DialogHeader>

      {mode === "intelligence" ? (
        <form onSubmit={(event) => void handleIntelligenceSubmit(event)}>
          <div className="flex flex-col gap-3 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <Badge variant="muted" className="gap-1">
                <SparkleIcon />
                Athas Intelligence
              </Badge>
              {repository ? (
                <span className="flex min-w-0 items-center gap-1.5 font-sans ui-text-sm text-subtle-foreground">
                  <GithubLogoIcon className="shrink-0" />
                  <span className="truncate">
                    {repository.owner}/{repository.repo}
                  </span>
                </span>
              ) : null}
            </div>
            <label className="flex flex-col gap-1.5 font-sans ui-text-sm text-foreground">
              What do you want to see?
              <Textarea
                autoFocus
                value={request}
                onChange={(event) => setRequest(event.target.value)}
                placeholder="GitHub release download stats"
                rows={4}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {["Release downloads", "Workflow runs", "Open pull requests"].map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setRequest(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
            {!isResolvingRepository && !repository ? (
              <p role="status" className="font-sans ui-text-sm text-warning">
                No GitHub remote was found for this project.
              </p>
            ) : null}
            {!hasIntelligence ? (
              <p className="font-sans ui-text-sm text-subtle-foreground">
                Common GitHub sources are configured automatically. Athas Pro Intelligence handles
                custom requests.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="font-sans ui-text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="self-start"
              onClick={() => {
                setMode("manual");
                setError(null);
              }}
            >
              Configure manually
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="accent"
              size="sm"
              disabled={isSaving || isResolvingRepository}
            >
              <SparkleIcon />
              {isSaving ? "Creating source..." : "Create Source"}
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <form onSubmit={(event) => void handleManualSubmit(event)}>
          <div className="flex flex-col gap-3 px-4 py-4">
            <label className="flex flex-col gap-1.5 font-sans ui-text-sm text-foreground">
              Source type
              <Select
                value={kind}
                onChange={(value) => {
                  setKind(value as AdminDataSource["kind"]);
                  setLocation("");
                }}
                options={[
                  { value: "github", label: "Project GitHub" },
                  { value: "json", label: "JSON URL" },
                ]}
              />
            </label>
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
              {kind === "github" ? "GitHub API path" : "JSON URL"}
              <Input
                type={kind === "json" ? "url" : "text"}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder={
                  kind === "github" ? "/releases?per_page=100" : "https://api.example.com/data"
                }
              />
              {kind === "github" && repository ? (
                <span className="text-subtle-foreground">
                  Relative to {repository.owner}/{repository.repo}
                </span>
              ) : null}
            </label>
            <label className="flex flex-col gap-1.5 font-sans ui-text-sm text-foreground">
              Rows path
              <Input
                value={rowsPath}
                onChange={(event) => setRowsPath(event.target.value)}
                placeholder="assets[]"
              />
              <span className="text-subtle-foreground">
                Optional. Use dot paths and [] to expand arrays.
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
            {!source ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="self-start"
                onClick={() => {
                  setMode("intelligence");
                  setError(null);
                }}
              >
                <SparkleIcon />
                Use Athas Intelligence
              </Button>
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
      )}
    </DialogContent>
  );
}
