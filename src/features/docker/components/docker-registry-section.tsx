import { DownloadSimpleIcon as Download, MagnifyingGlassIcon as Search } from "@/ui/icons";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import Input from "@/ui/input";
import { SearchField } from "@/ui/search";
import { SidebarSectionLabel } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import type { DockerRegistryDraft } from "../hooks/use-docker-registry";
import type { DockerRegistrySearchResult } from "../types/docker.types";
import { DockerActionMenu, DockerResourceRow } from "./docker-resource-rows";
import { DockerCapabilityNotice, DockerInlineError } from "./docker-sidebar-states";

interface DockerRegistrySectionProps {
  query: string;
  results: DockerRegistrySearchResult[];
  error: string | null;
  output: string | null;
  draft: DockerRegistryDraft;
  isBusy: boolean;
  isDockerDaemonReady: boolean;
  hasConnectionError: boolean;
  onQueryChange: (query: string) => void;
  onDraftFieldChange: (field: keyof DockerRegistryDraft, value: string) => void;
  onSearch: () => void | Promise<void>;
  onLogin: () => void | Promise<void>;
  onPull: (image: string) => void | Promise<void>;
  onPush: () => void | Promise<void>;
  onTag: () => void | Promise<void>;
  onDismissError: () => void;
}

export function DockerRegistrySection({
  query,
  results,
  error,
  output,
  draft,
  isBusy,
  isDockerDaemonReady,
  hasConnectionError,
  onQueryChange,
  onDraftFieldChange,
  onSearch,
  onLogin,
  onPull,
  onPush,
  onTag,
  onDismissError,
}: DockerRegistrySectionProps) {
  return (
    <>
      {hasConnectionError ? (
        <DockerCapabilityNotice>
          Search and login remain available. Start Docker to pull, push, or tag images.
        </DockerCapabilityNotice>
      ) : null}
      <div className="space-y-3 px-2 py-2">
        <div className="space-y-1">
          <SidebarSectionLabel>Docker Hub</SidebarSectionLabel>
          <div className="flex min-w-0 items-center gap-1.5">
            <SearchField
              value={query}
              onChange={onQueryChange}
              onKeyDown={(event) => {
                if (event.key === "Enter") void onSearch();
              }}
              placeholder="Search images"
              aria-label="Search Docker Hub"
              size="xs"
              className="min-w-0 flex-1 rounded-lg"
            />
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled={isBusy || !query.trim()}
              onClick={() => void onSearch()}
            >
              {isBusy ? <Spinner compact /> : <Search />}
              Search
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <SidebarSectionLabel>Image actions</SidebarSectionLabel>
          <Input
            value={draft.image}
            onChange={(event) => onDraftFieldChange("image", event.target.value)}
            placeholder="Image, for example nginx:latest"
            aria-label="Registry image"
            size="xs"
            className="w-full rounded-lg"
          />
          <Input
            value={draft.target}
            onChange={(event) => onDraftFieldChange("target", event.target.value)}
            placeholder="Target tag"
            aria-label="Target image tag"
            size="xs"
            className="w-full rounded-lg"
          />
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isBusy || !isDockerDaemonReady || !draft.image.trim()}
              onClick={() => void onPull(draft.image)}
            >
              Pull
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isBusy || !isDockerDaemonReady || !draft.image.trim()}
              onClick={() => void onPush()}
            >
              Push
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={
                isBusy || !isDockerDaemonReady || !draft.image.trim() || !draft.target.trim()
              }
              onClick={() => void onTag()}
            >
              Tag
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <SidebarSectionLabel>Registry login</SidebarSectionLabel>
          <Input
            value={draft.registry}
            onChange={(event) => onDraftFieldChange("registry", event.target.value)}
            placeholder="Registry (optional)"
            aria-label="Registry host"
            size="xs"
            className="w-full rounded-lg"
          />
          <Input
            value={draft.username}
            onChange={(event) => onDraftFieldChange("username", event.target.value)}
            placeholder="Username"
            aria-label="Registry username"
            size="xs"
            className="w-full rounded-lg"
          />
          <Input
            value={draft.password}
            onChange={(event) => onDraftFieldChange("password", event.target.value)}
            type="password"
            placeholder="Password"
            aria-label="Registry password"
            size="xs"
            className="w-full rounded-lg"
          />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isBusy || !draft.username.trim() || !draft.password}
            onClick={() => void onLogin()}
          >
            Login
          </Button>
        </div>
      </div>
      {error ? (
        <DockerInlineError
          title="Registry action failed"
          error={error}
          onDismiss={onDismissError}
          className="mx-2 mb-1 w-auto"
        />
      ) : null}
      {output ? (
        <div className="ui-text-sm mx-2 mb-1 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background px-2 py-1 font-mono text-subtle-foreground">
          {output}
        </div>
      ) : null}
      {results.length > 0 ? (
        results.map((result) => (
          <DockerResourceRow
            key={result.name}
            title={result.name}
            description={
              <>
                {result.starCount ? `${result.starCount} stars` : "Registry image"}
                {result.official === "[OK]" ? " · official" : ""}
                {result.automated === "[OK]" ? " · automated" : ""}
                {result.description ? ` · ${result.description}` : ""}
              </>
            }
            actions={
              <DockerActionMenu
                label={`Actions for ${result.name}`}
                actions={[
                  {
                    label: "Pull",
                    icon: <Download />,
                    disabled: isBusy || !isDockerDaemonReady,
                    onSelect: () => void onPull(result.name),
                  },
                ]}
              />
            }
          />
        ))
      ) : (
        <EmptyState layout="sidebar" message="Search Docker Hub to find images" />
      )}
    </>
  );
}
