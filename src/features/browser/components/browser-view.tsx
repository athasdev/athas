import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useKeymapStore } from "@/features/keymaps/stores/keymaps.store";
import { activateBufferInPaneAndSync } from "@/features/panes/utils/pane-activation";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import type { BrowserContent } from "@/features/panes/types/pane-content.types";
import { ViewerErrorState } from "@/features/viewer/components/viewer-state";
import { openExternalBrowserUrl } from "@/features/window/utils/external-navigation";
import { useWorkspaceStoreScopeId } from "@/features/workspace/stores/create-workspace-scoped-store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/empty";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BugIcon,
  CopyIcon,
  DotsIcon,
  GlobeIcon,
  LockIcon,
  OpenExternalIcon,
  TrashIcon,
  XIcon,
} from "@/ui/icons";
import Input from "@/ui/input";
import { writeClipboardText } from "@/utils/clipboard";
import { browserTabManager } from "../services/browser-tab-manager";
import { useBrowserTabState } from "../stores/browser-tab.store";
import {
  formatBrowserAddress,
  isBlankPage,
  isSecureAddress,
  resolveBrowserAddress,
} from "../utils/browser-address";
import { onAppEvent } from "@/utils/app-events";

interface BrowserViewProps {
  buffer: BrowserContent;
  paneId: string;
  isActive: boolean;
}

export function BrowserView({ buffer, paneId, isActive }: BrowserViewProps) {
  const workspaceId = useWorkspaceStoreScopeId();
  const { setContext } = useKeymapStore.use.actions();
  const { isLoading, canGoBack, canGoForward, error } = useBrowserTabState(buffer.id);
  const slotRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const isBlank = isBlankPage(buffer.url);

  const urlRef = useRef(buffer.url);
  urlRef.current = buffer.url;

  useEffect(() => {
    const element = slotRef.current;
    if (!element) return;
    return browserTabManager.attach(
      buffer.id,
      workspaceId,
      {
        element,
        onFocus: () => {
          activateBufferInPaneAndSync(paneId, buffer.id);
          setDraft(null);
        },
      },
      urlRef.current,
    );
  }, [buffer.id, paneId, workspaceId]);

  useEffect(() => {
    if (isActive && isBlank) addressRef.current?.focus();
  }, [isActive, isBlank]);

  useEffect(() => {
    if (!isActive) return;
    setContext("browserFocus", true);
    return () => setContext("browserFocus", false);
  }, [isActive, setContext]);

  useEffect(() => {
    return onAppEvent("athas-browser-focus-address-bar", (bufferId) => {
      if (bufferId !== buffer.id) return;
      addressRef.current?.focus();
      addressRef.current?.select();
    });
  }, [buffer.id]);

  const submitAddress = () => {
    const url = resolveBrowserAddress(draft ?? "");
    if (!url) return;
    setDraft(null);
    browserTabManager.navigate(buffer.id, url);
    if (!isBlankPage(url)) browserTabManager.focusPage(buffer.id);
  };

  const copyAddress = async () => {
    await writeClipboardText(buffer.url);
    toast.success("Copied address");
  };

  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <PaneContentHeader
        leading={
          <>
            <Button
              variant="ghost"
              iconOnly
              tooltip="Back"
              commandId="browser.back"
              disabled={isBlank || canGoBack === false}
              onClick={() => browserTabManager.perform(buffer.id, "back")}
            >
              <ArrowLeftIcon />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              tooltip="Forward"
              commandId="browser.forward"
              disabled={isBlank || canGoForward === false}
              onClick={() => browserTabManager.perform(buffer.id, "forward")}
            >
              <ArrowRightIcon />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              tooltip={isLoading ? "Stop" : "Reload"}
              commandId={isLoading ? undefined : "browser.reload"}
              disabled={isBlank}
              onClick={() => browserTabManager.perform(buffer.id, isLoading ? "stop" : "reload")}
            >
              {isLoading ? <XIcon /> : <ArrowClockwiseIcon />}
            </Button>
          </>
        }
        context={
          <form
            className="flex min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              submitAddress();
            }}
          >
            <Input
              ref={addressRef}
              size="sm"
              grow
              leftIcon={isSecureAddress(buffer.url) ? LockIcon : GlobeIcon}
              aria-label="Address"
              placeholder="Search or enter address"
              value={draft ?? formatBrowserAddress(buffer.url)}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.target.select()}
              onBlur={() => setDraft(null)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                setDraft(null);
                if (!isBlank) browserTabManager.focusPage(buffer.id);
              }}
            />
          </form>
        }
        actions={
          <>
            {buffer.zoom && buffer.zoom !== 1 ? (
              <Button
                variant="ghost"
                tooltip="Reset zoom"
                onClick={() => browserTabManager.zoom(buffer.id, 0)}
              >
                {Math.round(buffer.zoom * 100)}%
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" iconOnly tooltip="Page actions" />}
              >
                <DotsIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={isBlank}
                  onClick={() => void openExternalBrowserUrl(buffer.url)}
                >
                  <OpenExternalIcon />
                  Open in System Browser
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isBlank} onClick={() => void copyAddress()}>
                  <CopyIcon />
                  Copy Address
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isBlank}
                  onClick={() => browserTabManager.openDevTools(buffer.id)}
                >
                  <BugIcon />
                  Developer Tools
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isBlank}
                  onClick={() => void browserTabManager.clearBrowsingData(buffer.id)}
                >
                  <TrashIcon />
                  Clear Browsing Data
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div ref={slotRef} data-browser-slot className="relative min-h-0 flex-1">
        {error ? (
          <ViewerErrorState
            message={error}
            actionLabel="Try Again"
            onAction={() => browserTabManager.navigate(buffer.id, buffer.url)}
          />
        ) : isBlank ? (
          <Empty className="size-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GlobeIcon />
              </EmptyMedia>
              <EmptyTitle>Browse the web</EmptyTitle>
              <EmptyDescription>
                Search or enter an address, such as localhost:5173 or athas.dev
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
    </div>
  );
}
