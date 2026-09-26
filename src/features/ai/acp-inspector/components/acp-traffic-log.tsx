import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import Badge, { type BadgeTone } from "@/ui/badge";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  TerminalIcon,
} from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { formatTrafficMessage } from "../lib/acp-traffic-messages";
import type { AcpTrafficDirection, AcpTrafficMessage } from "../types/acp-traffic.types";
import { AcpJsonBlock } from "./acp-json-block";

const DIRECTION = {
  in: { label: "In", title: "From the agent", Icon: ArrowLeftIcon },
  out: { label: "Out", title: "To the agent", Icon: ArrowRightIcon },
  stderr: { label: "Stderr", title: "Agent stderr", Icon: TerminalIcon },
} satisfies Record<AcpTrafficDirection, unknown>;

function kindTone(message: AcpTrafficMessage): BadgeTone {
  if (message.isError) return "danger";
  if (message.kind === "request") return "accent";
  if (message.kind === "response") return "success";
  if (message.kind === "stderr") return "warning";
  return "neutral";
}

function formatTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** Estimated heights before a row is measured; detail rows vary with their payload. */
const MESSAGE_ROW_HEIGHT = 33;
const DETAIL_ROW_HEIGHT = 240;
const COLUMN_COUNT = 7;

type LogRow = { kind: "message" | "detail"; message: AcpTrafficMessage };

function latencyLabel(message: AcpTrafficMessage): string {
  if (message.latencyMs !== null) return `${message.latencyMs} ms`;
  return message.kind === "request" ? "Pending" : "";
}

interface AcpTrafficLogProps {
  messages: AcpTrafficMessage[];
  /** Every message by key, so a row can reach its partner even when the filter hides it. */
  messagesByKey: Map<string, AcpTrafficMessage>;
  emptyMessage: string;
  onCopy: (message: AcpTrafficMessage) => void;
}

export function AcpTrafficLog({
  messages,
  messagesByKey,
  emptyMessage,
  onCopy,
}: AcpTrafficLogProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Only the rows in view are rendered, so a long log stays cheap to scroll and update.
  const rows = useMemo(
    () =>
      messages.flatMap((message): LogRow[] =>
        expanded.has(message.key)
          ? [
              { kind: "message", message },
              { kind: "detail", message },
            ]
          : [{ kind: "message", message }],
      ),
    [messages, expanded],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === "detail" ? DETAIL_ROW_HEIGHT : MESSAGE_ROW_HEIGHT,
    getItemKey: (index) => `${rows[index].message.key}:${rows[index].kind}`,
    initialRect: { width: 0, height: 800 },
    overscan: 10,
  });

  useEffect(() => {
    if (!scrollTarget) return;
    const index = rows.findIndex(
      (row) => row.kind === "message" && row.message.key === scrollTarget,
    );
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "start" });
    setScrollTarget(null);
  }, [rows, scrollTarget, virtualizer]);

  const toggle = (key: string, open?: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const revealPartner = (message: AcpTrafficMessage) => {
    if (!message.partnerKey) return;
    toggle(message.partnerKey, true);
    setScrollTarget(message.partnerKey);
  };

  if (messages.length === 0) {
    return <EmptyState className="min-h-40" message={emptyMessage} />;
  }

  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <ScrollArea fill="flex" viewportProps={{ ref: viewportRef }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <span className="sr-only">Expand</span>
            </TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Id</TableHead>
            <TableHead>Latency</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paddingTop > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={COLUMN_COUNT} style={{ height: paddingTop, padding: 0 }} />
            </tr>
          ) : null}
          {virtualRows.map((virtualRow) => {
            const { kind, message } = rows[virtualRow.index];
            if (kind === "detail") {
              const partner = message.partnerKey
                ? messagesByKey.get(message.partnerKey)
                : undefined;
              return (
                <TableRow
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                >
                  <TableCell />
                  <TableCell colSpan={6}>
                    <div className="flex flex-col gap-2 pb-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onCopy(message)}
                        >
                          <CopyIcon />
                          Copy
                        </Button>
                        {partner ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => revealPartner(message)}
                          >
                            {partner.kind === "response" ? "Show response" : "Show request"}
                          </Button>
                        ) : null}
                        {message.sessionId ? (
                          <span className="font-mono text-subtle-foreground ui-text-caption">
                            {message.sessionId}
                          </span>
                        ) : null}
                        {message.truncated ? (
                          <Badge tone="warning">Cut to the first 64 KiB</Badge>
                        ) : null}
                      </div>
                      <AcpJsonBlock value={formatTrafficMessage(message)} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            }
            const isOpen = expanded.has(message.key);
            const direction = DIRECTION[message.direction];
            return (
              <TableRow
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                data-traffic-key={message.key}
                data-state={isOpen ? "selected" : undefined}
                onClick={() => toggle(message.key)}
              >
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    iconOnly
                    aria-label={isOpen ? "Collapse message" : "Expand message"}
                    aria-expanded={isOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(message.key);
                    }}
                  >
                    {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  </Button>
                </TableCell>
                <TableCell className="font-mono tabular-nums text-subtle-foreground">
                  {formatTime(message.timestampMs)}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1" title={direction.title}>
                    <direction.Icon />
                    {direction.label}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge tone={kindTone(message)}>{message.isError ? "error" : message.kind}</Badge>
                </TableCell>
                <TableCell className="max-w-96 truncate font-mono">
                  {message.kind === "stderr" ? message.raw : (message.method ?? "")}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{message.id ?? ""}</TableCell>
                <TableCell className="tabular-nums text-subtle-foreground">
                  {latencyLabel(message)}
                </TableCell>
              </TableRow>
            );
          })}
          {paddingBottom > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={COLUMN_COUNT} style={{ height: paddingBottom, padding: 0 }} />
            </tr>
          ) : null}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
