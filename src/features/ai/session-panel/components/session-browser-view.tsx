import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { BrowserPage } from "@/features/browser/components/browser-page";
import { browserTabManager } from "@/features/browser/services/browser-tab-manager";
import type { BrowserPageStore } from "@/features/browser/types/browser-page.types";
import { useHostedBrowserRunsStore } from "@/features/browser-use/stores/hosted-browser-runs.store";
import { activateBufferInPaneAndSync } from "@/features/panes/services/pane-activation";
import { detectLocalPorts } from "@/features/previews/services/detect-local-ports";
import {
  previewsStoreDependencies,
  usePreviewsStore,
} from "@/features/previews/stores/previews.store";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  BroadcastIcon,
  CopyIcon,
  GlobeIcon,
  LaptopIcon,
  OpenExternalIcon,
  StopIcon,
} from "@/ui/icons";
import { tryWriteClipboardText } from "@/utils/clipboard";
import { openExternalUrl } from "@/utils/external-url";
import { getLocalServerPort } from "../services/dev-server-urls";
import {
  getSessionBrowserPageId,
  selectSessionPanel,
  useSessionPanel,
  useSessionPanelStore,
} from "../stores/session-panel.store";

const EMPTY_SERVERS: string[] = [];

function displayAddress(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

/** The preview link for the page the browser shows, keeping its path. */
function previewLinkFor(previewUrl: string, pageUrl: string) {
  try {
    const page = new URL(pageUrl);
    return new URL(`${page.pathname}${page.search}`, previewUrl).toString();
  } catch {
    return previewUrl;
  }
}

async function copyPreviewLink(url: string) {
  if (await tryWriteClipboardText(url)) {
    toast.success("Preview link copied", {
      description: url,
      action: { label: "Open", onClick: () => void openExternalUrl(url) },
    });
  } else {
    toast.error("Could not copy the preview link");
  }
}

function ServerMenu({ chatId, pageId }: { chatId: string; pageId: string }) {
  const servers = useSessionPanelStore((state) => state.servers[chatId] ?? EMPTY_SERVERS);
  const detected = useQuery({
    queryKey: ["session-panel", "local-ports"],
    queryFn: () => detectLocalPorts(previewsStoreDependencies.fetch),
    staleTime: 10_000,
  });
  const sessionPorts = new Set(servers.map(getLocalServerPort));
  const others = (detected.data ?? []).filter((port) => !sessionPorts.has(port));

  const open = (url: string) => {
    browserTabManager.navigate(pageId, url);
    browserTabManager.focusPage(pageId);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" iconOnly tooltip="Local servers" />}
      >
        <LaptopIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="wide">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Started in this session</DropdownMenuLabel>
          {servers.length ? (
            servers.map((url) => (
              <DropdownMenuItem key={url} onClick={() => open(url)}>
                <GlobeIcon />
                {displayAddress(url)}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuEmpty>No servers yet</DropdownMenuEmpty>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Running on this computer</DropdownMenuLabel>
          {others.length ? (
            others.map((port) => (
              <DropdownMenuItem key={port} onClick={() => open(`http://localhost:${port}/`)}>
                <LaptopIcon />
                localhost:{port}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuEmpty>
              {detected.isPending ? "Looking for servers…" : "No other servers found"}
            </DropdownMenuEmpty>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shares the local server the page shows through a temporary preview link. */
function ShareButton({ url }: { url: string }) {
  const port = getLocalServerPort(url);
  const { hasPreviews } = useProFeature();
  const shared = usePreviewsStore((state) =>
    port === null
      ? undefined
      : Object.values(state.shared).find(
          (entry) => entry.preview.kind === "local" && entry.preview.port === port,
        ),
  );
  const { shareLocalServer, stopPreview, openDialog } = usePreviewsStore.use.actions();
  const share = useMutation({
    mutationFn: (value: number) => shareLocalServer(value),
    onSuccess: (preview) => copyPreviewLink(previewLinkFor(preview.url, url)),
    onError: (error) => toast.error(error.message),
  });

  if (port === null) {
    return (
      <Button type="button" variant="ghost" disabled tooltip="Open a local server to share it">
        <BroadcastIcon />
        Share
      </Button>
    );
  }

  if (shared) {
    const link = previewLinkFor(shared.preview.url, url);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="ghost" active tooltip={`Sharing localhost:${port}`} />
          }
        >
          <BroadcastIcon />
          Shared
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" size="default">
          <DropdownMenuItem onClick={() => void copyPreviewLink(link)}>
            <CopyIcon />
            Copy Preview Link
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void openExternalUrl(link)}>
            <OpenExternalIcon />
            Open Preview Link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              void stopPreview(shared.preview.id).catch((error: Error) =>
                toast.error(error.message),
              )
            }
          >
            <StopIcon />
            Stop Sharing
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      tooltip={`Share localhost:${port} with a preview link`}
      disabled={share.isPending}
      onClick={() => (hasPreviews ? share.mutate(port) : openDialog())}
    >
      <BroadcastIcon />
      {share.isPending ? "Sharing…" : "Share"}
    </Button>
  );
}

/** Shown while the agent runs a task on the hosted browser, which this page does not mirror. */
function HostedBrowserBanner({ chatId, pageId }: { chatId: string; pageId: string }) {
  const run = useHostedBrowserRunsStore((state) => state.runs[chatId]);
  if (!run) return null;
  return (
    <Alert tone="info" variant="banner" role="status">
      <GlobeIcon />
      <AlertTitle>Agent is browsing {displayAddress(run.url)}</AlertTitle>
      <AlertDescription>It runs on Athas's hosted browser, not on this page.</AlertDescription>
      <AlertActions>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            browserTabManager.navigate(pageId, run.url);
            browserTabManager.focusPage(pageId);
          }}
        >
          Open here
        </Button>
      </AlertActions>
    </Alert>
  );
}

/** The session's browser: local servers it started, sharing them, and the agent's browsing. */
export function SessionBrowserView({
  chatId,
  paneId,
  agentBufferId,
}: {
  chatId: string;
  paneId: string | undefined;
  agentBufferId: string | undefined;
}) {
  const panel = useSessionPanel(chatId);
  const pageId = getSessionBrowserPageId(chatId);
  const url = panel.browserUrl || "about:blank";
  const pageStore = useMemo<BrowserPageStore>(
    () => ({
      read: () => {
        const current = selectSessionPanel(useSessionPanelStore.getState(), chatId);
        return { url: current.browserUrl || "about:blank", zoom: current.browserZoom };
      },
      update: (patch) => {
        const page: { url?: string; zoom?: number } = {};
        if (patch.url !== undefined) page.url = patch.url;
        if ("zoom" in patch) page.zoom = patch.zoom;
        if ("url" in page || "zoom" in page) {
          useSessionPanelStore.getState().actions.setBrowserPage(chatId, page);
        }
      },
    }),
    [chatId],
  );

  return (
    <BrowserPage
      pageId={pageId}
      url={url}
      zoom={panel.browserZoom}
      isActive={false}
      pageStore={pageStore}
      onPageFocus={() => {
        if (paneId && agentBufferId) activateBufferInPaneAndSync(paneId, agentBufferId);
      }}
      addressLeading={<ServerMenu chatId={chatId} pageId={pageId} />}
      actions={<ShareButton url={url} />}
      banner={<HostedBrowserBanner chatId={chatId} pageId={pageId} />}
    />
  );
}
