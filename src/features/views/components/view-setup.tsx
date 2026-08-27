import { useEffect, useState, type FormEvent } from "react";
import {
  resolveProjectGitHubRepository,
  type GitHubRepository,
} from "@/features/views/lib/view-github";
import {
  generateCustomView,
  createKnownGitHubView,
} from "@/features/views/services/view-generator";
import type { CustomViewDefinition, ViewLayout } from "@/features/views/types/view.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { useAuthStore } from "@/features/window/stores/auth.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import Input from "@/ui/input";
import { GithubLogoIcon, SparkleIcon } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import Select from "@/ui/select";
import Textarea from "@/ui/textarea";

interface ViewSetupProps {
  projectPath: string;
  view?: CustomViewDefinition;
  onCancel: () => void;
  onSave: (view: CustomViewDefinition) => Promise<void>;
}

function isGitHubApiUrl(value: string): boolean {
  try {
    return new URL(value).hostname === "api.github.com";
  } catch {
    return false;
  }
}

export function ViewSetup({ projectPath, view, onCancel, onSave }: ViewSetupProps) {
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const hasIntelligence = hasProductCapability(subscription, "intelligence");
  const [mode, setMode] = useState<"intelligence" | "manual">(view ? "manual" : "intelligence");
  const [request, setRequest] = useState("");
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const [isResolvingRepository, setIsResolvingRepository] = useState(true);
  const [kind, setKind] = useState<CustomViewDefinition["kind"]>(view?.kind ?? "github");
  const [name, setName] = useState(view?.name ?? "");
  const [location, setLocation] = useState(
    view?.kind === "github" ? view.endpointPath : (view?.url ?? ""),
  );
  const [rowsPath, setRowsPath] = useState(view?.rowsPath ?? "");
  const [layout, setLayout] = useState<ViewLayout>(view?.presentation?.layout ?? "table");
  const [groupBy, setGroupBy] = useState(view?.presentation?.groupBy ?? "");
  const [useGitHubAccount, setUseGitHubAccount] = useState(
    view?.kind === "json" && view.authentication === "github",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canUseGitHubAccount = kind === "json" && isGitHubApiUrl(location);

  useEffect(() => {
    let cancelled = false;

    const resolveRepository = async () => {
      setIsResolvingRepository(true);
      try {
        const nextRepository = await resolveProjectGitHubRepository(projectPath);
        if (!cancelled) setRepository(nextRepository);
      } finally {
        if (!cancelled) setIsResolvingRepository(false);
      }
    };

    void resolveRepository();
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
      setError("Describe the view you want to create");
      return;
    }
    if (!repository) {
      setError("This project does not have a GitHub remote. Configure the view manually.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      let generatedView: CustomViewDefinition | null = null;
      let intelligenceError: unknown = null;

      if (isAuthenticated && hasIntelligence) {
        try {
          generatedView = await generateCustomView({
            request: trimmedRequest,
            repository,
            model: aiAutocompleteModelId,
          });
        } catch (nextError) {
          intelligenceError = nextError;
        }
      }

      generatedView ??= createKnownGitHubView(trimmedRequest);
      if (!generatedView) {
        throw (
          intelligenceError ??
          new Error("This request needs manual configuration. Choose Configure manually.")
        );
      }

      await onSave(generatedView);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not create this view");
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
        id: view?.id ?? crypto.randomUUID(),
        name: trimmedName,
        rowsPath: rowsPath.trim(),
        presentation: {
          layout,
          ...(groupBy.trim() ? { groupBy: groupBy.trim() } : {}),
        },
      };
      const nextView: CustomViewDefinition =
        kind === "github"
          ? { ...base, kind, endpointPath: trimmedLocation }
          : {
              ...base,
              kind,
              url: trimmedLocation,
              authentication: useGitHubAccount ? "github" : "none",
            };

      await onSave(nextView);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not load this view");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScrollArea
      className="h-full bg-background"
      contentClassName="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16"
    >
      <div className="mb-7 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
        <h1 className="font-sans ui-text-base leading-tight font-semibold tracking-tight text-foreground">
          {view ? `Edit ${view.name}` : "Create a custom view"}
        </h1>
        <p className="font-sans ui-text-sm text-subtle-foreground">
          {mode === "intelligence"
            ? "Describe what you want to see and Athas will generate the view."
            : "Connect the view to a data source when automatic setup is not enough."}
        </p>
      </div>

      {mode === "intelligence" ? (
        <form className="space-y-5" onSubmit={(event) => void handleIntelligenceSubmit(event)}>
          <label className="flex flex-col gap-2 font-sans ui-text-sm text-foreground">
            What do you want to see?
            <Textarea
              autoFocus
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="GitHub release download stats"
              rows={6}
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
              Common GitHub views are generated automatically. Athas Pro Intelligence handles custom
              requests.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="font-sans ui-text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-border/60 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setMode("manual");
                setError(null);
              }}
            >
              Configure manually
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                size="sm"
                disabled={isSaving || isResolvingRepository}
              >
                <SparkleIcon />
                {isSaving ? "Creating view..." : "Create View"}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <form className="space-y-5" onSubmit={(event) => void handleManualSubmit(event)}>
          <label className="flex flex-col gap-2 font-sans ui-text-sm text-foreground">
            Source type
            <Select
              value={kind}
              onChange={(value) => {
                setKind(value as CustomViewDefinition["kind"]);
                setLocation("");
              }}
              options={[
                { value: "github", label: "Project GitHub" },
                { value: "json", label: "JSON URL" },
              ]}
            />
          </label>
          <label className="flex flex-col gap-2 font-sans ui-text-sm text-foreground">
            View name
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Release downloads"
            />
          </label>
          <label className="flex flex-col gap-2 font-sans ui-text-sm text-foreground">
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
          <label className="flex flex-col gap-2 font-sans ui-text-sm text-foreground">
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 font-sans ui-text-sm text-foreground">
              Display as
              <Select
                value={layout}
                onChange={(value) => setLayout(value as ViewLayout)}
                options={[
                  { value: "table", label: "Table" },
                  { value: "list", label: "List" },
                  { value: "board", label: "Board" },
                ]}
              />
            </label>
            <label className="flex flex-col gap-2 font-sans ui-text-sm text-foreground">
              Group by column
              <Input
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value)}
                placeholder="status"
              />
              <span className="text-subtle-foreground">Optional for table and list views.</span>
            </label>
          </div>
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
          <div className="flex items-center justify-between gap-3 border-border/60 border-t pt-4">
            {!view ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMode("intelligence");
                  setError(null);
                }}
              >
                <SparkleIcon />
                Use Athas Intelligence
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" variant="accent" size="sm" disabled={isSaving}>
                {isSaving ? "Testing view..." : view ? "Save View" : "Create View"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </ScrollArea>
  );
}
