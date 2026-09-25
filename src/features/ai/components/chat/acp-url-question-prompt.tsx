import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { GlobeIcon, LinkIcon, WarningIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";
import {
  type AcpElicitationResponse,
  type AcpUrlElicitationRequest,
  inspectElicitationUrl,
} from "../../lib/acp-elicitation";
import { chatContentWidth } from "./chat-content-width";

/**
 * An agent's URL-mode `elicitation/create`: it asks the user to open a page, usually to sign in to
 * an MCP server. Following the spec, the link is never opened or fetched without consent, its host
 * is shown up front with the full URL beneath it, and it opens in the system browser, out of the
 * agent's reach. Accepting only means the user opened it; the prompt stays, waiting, until the agent
 * reports the flow complete, and the user can reopen the link or dismiss it.
 */
export function AcpUrlQuestionPrompt({
  request,
  agentLabel,
  queuedCount,
  waiting,
  onAnswer,
  onDismiss,
}: {
  request: AcpUrlElicitationRequest;
  agentLabel: string;
  queuedCount: number;
  waiting: boolean;
  onAnswer: (response: AcpElicitationResponse) => void;
  onDismiss: () => void;
}) {
  const link = useMemo(() => inspectElicitationUrl(request.url), [request.url]);
  const [openError, setOpenError] = useState<string | null>(null);

  const open = async () => {
    if (!link.openable) return;
    try {
      await openUrl(link.href);
      setOpenError(null);
      if (!waiting) onAnswer({ action: "accept" });
    } catch (error) {
      console.error("Failed to open agent link:", error);
      setOpenError("Athas could not open your browser. Copy the link instead.");
    }
  };

  return (
    <div
      className={cn(
        chatContentWidth(),
        "mb-1 flex flex-col gap-2.5 rounded-xl border border-border bg-background p-2.5 shadow-(--shadow-card) ui-text-sm",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <LinkIcon className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-subtle-foreground ui-text-caption">
            {agentLabel}{" "}
            {waiting ? "is waiting for you in the browser" : "wants you to open a link"}
          </span>
          <p className="text-pretty text-foreground">{request.message}</p>
        </div>
        {queuedCount > 0 ? <Badge>+{queuedCount}</Badge> : null}
      </div>

      <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-2.5 py-2">
        {link.openable ? (
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            <GlobeIcon className="size-3.5 shrink-0 text-subtle-foreground" />
            <span className="min-w-0 truncate">{link.host}</span>
          </span>
        ) : null}
        <span className="font-mono wrap-anywhere select-text text-muted-foreground ui-text-caption">
          {request.url}
        </span>
      </div>

      {link.openable && link.punycode ? (
        <p className="flex items-start gap-1.5 text-pretty text-warning">
          <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
          This address uses an internationalized domain, which can imitate a familiar one. Check it
          is the site you expect.
        </p>
      ) : null}
      {link.openable && link.insecure ? (
        <p className="flex items-start gap-1.5 text-pretty text-warning">
          <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
          This link is not encrypted. Don't enter passwords on it.
        </p>
      ) : null}
      {!link.openable ? (
        <p className="flex items-start gap-1.5 text-pretty text-destructive">
          <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
          {link.reason}
        </p>
      ) : null}
      {openError ? <p className="text-pretty text-destructive">{openError}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-1">
        {waiting ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              tooltip="Hide this; the agent keeps waiting until the page finishes"
            >
              Dismiss
            </Button>
            {link.openable ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void open()}>
                Open again
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onAnswer({ action: "decline" })}
              tooltip="Don't open it; the agent continues without it"
            >
              Decline
            </Button>
            <Button
              type="button"
              variant="ghost"
              tone="danger"
              size="sm"
              onClick={() => onAnswer({ action: "cancel" })}
              tooltip="Cancel what the agent was doing"
            >
              Cancel
            </Button>
            {link.openable ? (
              <Button type="button" variant="accent" size="sm" onClick={() => void open()}>
                Open in browser
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
