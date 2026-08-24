import { Fragment } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import Badge from "@/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card";
import { EmptyState } from "@/ui/empty";
import { DiffPreview } from "@/ui/diff-preview";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/ui/item";
import { Progress, ProgressLabel, ProgressValue } from "@/ui/progress";
import { ScrollArea } from "@/ui/scroll-area";
import { SidebarListItem, SidebarPanel, SidebarSectionLabel, SidebarTitleBar } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import { cn } from "@/utils/cn";
import {
  ExtensionButtonControl,
  ExtensionCheckboxControl,
  ExtensionChoiceControl,
  ExtensionDisclosureControl,
  ExtensionFormControl,
  ExtensionInputControl,
  ExtensionNumberInputControl,
  ExtensionScreenActionControl,
  ExtensionSelectControl,
  ExtensionTabsControl,
  ExtensionTextareaControl,
  ExtensionToggleControl,
  type ExtensionViewExecute,
} from "./extension-view-controls";
import { ExtensionViewActivity } from "./extension-view-activity";
import { ExtensionViewTree } from "./extension-view-tree";
import { ExtensionViewBarChart, ExtensionViewSparkline } from "./extension-view-visualizations";
import type { ExtensionViewNode, ExtensionViewTone } from "../types/extension-view";

export type ExtensionViewSurface = "sidebar" | "embedded";

interface ExtensionViewRendererProps {
  node: ExtensionViewNode;
  execute: ExtensionViewExecute;
  surface?: ExtensionViewSurface;
}

const badgeTone = (tone: ExtensionViewTone | undefined) =>
  tone === "error" ? "error" : (tone ?? "default");

const metricToneClassName = (tone: ExtensionViewTone | undefined) => {
  if (tone === "accent") return "text-primary";
  if (tone === "success") return "text-success";
  if (tone === "warning") return "text-warning";
  if (tone === "error") return "text-destructive";
  if (tone === "muted") return "text-subtle-foreground";
  return "text-foreground";
};

const textToneClassName = (tone: ExtensionViewTone | undefined) =>
  tone === undefined || tone === "default" || tone === "muted"
    ? "text-subtle-foreground"
    : metricToneClassName(tone);

function renderNode(
  node: ExtensionViewNode,
  execute: ExtensionViewRendererProps["execute"],
  key: number | string,
  surface: ExtensionViewSurface,
) {
  switch (node.type) {
    case "screen": {
      const actions = node.actions?.map((item) => (
        <ExtensionScreenActionControl key={item.label} action={item} execute={execute} />
      ));

      if (surface === "embedded") {
        return (
          <div key={key} data-slot="extension-view-screen" className="flex min-w-0 flex-col gap-2">
            {node.title || actions?.length ? (
              <div className="flex min-w-0 items-center justify-between gap-2">
                {node.title ? (
                  <div className="truncate font-medium text-foreground ui-text-sm">
                    {node.title}
                  </div>
                ) : (
                  <span />
                )}
                {actions?.length ? <div className="flex items-center gap-1">{actions}</div> : null}
              </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-2">
              {node.children.map((child, index) => renderNode(child, execute, index, surface))}
            </div>
          </div>
        );
      }

      return (
        <SidebarPanel key={key}>
          {node.title || node.actions?.length ? (
            <SidebarTitleBar title={node.title ?? ""}>{actions}</SidebarTitleBar>
          ) : null}
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-2 p-2">
              {node.children.map((child, index) => renderNode(child, execute, index, surface))}
            </div>
          </ScrollArea>
        </SidebarPanel>
      );
    }
    case "stack":
      return (
        <div key={key} className="flex flex-col gap-2">
          {node.children.map((child, index) => renderNode(child, execute, index, surface))}
        </div>
      );
    case "row":
      return (
        <div key={key} className="flex min-w-0 flex-wrap items-center gap-2">
          {node.children.map((child, index) => renderNode(child, execute, index, surface))}
        </div>
      );
    case "section":
      return (
        <section key={key} className="min-w-0">
          {surface === "sidebar" ? (
            <SidebarSectionLabel>{node.title}</SidebarSectionLabel>
          ) : (
            <div className="mb-1 font-medium text-foreground ui-text-sm">{node.title}</div>
          )}
          <div className="flex flex-col gap-0.5">
            {node.children.map((child, index) => renderNode(child, execute, index, surface))}
          </div>
        </section>
      );
    case "card":
      return (
        <Card key={key} variant={node.variant ?? "default"} size="sm">
          {node.title || node.description ? (
            <CardHeader>
              {node.title ? <CardTitle>{node.title}</CardTitle> : null}
              {node.description ? <CardDescription>{node.description}</CardDescription> : null}
            </CardHeader>
          ) : null}
          {node.children.length ? (
            <CardContent className="flex min-w-0 flex-col gap-2">
              {node.children.map((child, index) => renderNode(child, execute, index, surface))}
            </CardContent>
          ) : null}
        </Card>
      );
    case "form":
      return (
        <ExtensionFormControl
          key={key}
          node={node}
          execute={execute}
          renderChildren={(children) =>
            children.map((child, index) => renderNode(child, execute, index, surface))
          }
        />
      );
    case "text":
      return (
        <p key={key} className={cn("ui-text-sm", textToneClassName(node.tone))}>
          {node.value}
        </p>
      );
    case "badge":
      return (
        <Badge key={key} variant={badgeTone(node.tone)} size="compact">
          {node.label}
        </Badge>
      );
    case "metric":
      return (
        <Card key={key} variant="muted" size="sm" className="min-w-0 flex-1 basis-24">
          <CardContent className="flex min-w-0 items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-subtle-foreground">{node.label}</div>
              <div
                className={cn("truncate font-medium tabular-nums", metricToneClassName(node.tone))}
              >
                {node.value}
              </div>
            </div>
            {node.detail ? (
              <div className="shrink-0 text-subtle-foreground tabular-nums">{node.detail}</div>
            ) : null}
          </CardContent>
        </Card>
      );
    case "progress": {
      const value = Number.isFinite(node.value) ? Math.min(100, Math.max(0, node.value)) : 0;
      return (
        <Progress key={key} value={value} aria-label={node.label ?? "Progress"}>
          {node.label ? <ProgressLabel>{node.label}</ProgressLabel> : null}
          <ProgressValue>{() => node.detail ?? `${Math.round(value)}%`}</ProgressValue>
        </Progress>
      );
    }
    case "sparkline":
      return <ExtensionViewSparkline key={key} node={node} />;
    case "barChart":
      return <ExtensionViewBarChart key={key} node={node} />;
    case "callout":
      return (
        <Alert
          key={key}
          tone={node.tone ?? "default"}
          role={node.tone === "error" ? "alert" : "status"}
        >
          <AlertTitle>{node.title}</AlertTitle>
          {node.description ? <AlertDescription>{node.description}</AlertDescription> : null}
        </Alert>
      );
    case "table":
      return (
        <div key={key} className="max-w-full overflow-x-auto rounded-lg border border-border/70">
          <Table>
            {node.caption ? <TableCaption>{node.caption}</TableCaption> : null}
            <TableHeader className="static">
              <TableRow>
                {node.columns.map((column, index) => (
                  <TableHead key={`${column}-${index}`}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {node.rows.map((row, rowIndex) => (
                <TableRow key={`row-${rowIndex}`}>
                  {node.columns.map((_, columnIndex) => (
                    <TableCell key={`cell-${rowIndex}-${columnIndex}`}>
                      {row[columnIndex] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    case "code":
      return (
        <pre
          key={key}
          className={cn(
            "max-w-full overflow-x-auto rounded-lg bg-surface/55 p-2 font-mono ui-text-sm text-foreground",
            node.wrap && "whitespace-pre-wrap break-words",
          )}
        >
          <code data-language={node.language}>{node.value}</code>
        </pre>
      );
    case "diff":
      return (
        <DiffPreview
          key={key}
          filePath={node.filePath}
          oldPath={node.oldPath}
          language={node.language}
          lines={node.lines}
          truncated={node.truncated}
        />
      );
    case "activity":
      return <ExtensionViewActivity key={key} node={node} execute={execute} />;
    case "button":
      return <ExtensionButtonControl key={key} node={node} execute={execute} />;
    case "input":
      return (
        <ExtensionInputControl key={`${key}:${node.value ?? ""}`} node={node} execute={execute} />
      );
    case "textarea":
      return (
        <ExtensionTextareaControl
          key={`${key}:${node.value ?? ""}`}
          node={node}
          execute={execute}
        />
      );
    case "numberInput":
      return (
        <ExtensionNumberInputControl
          key={`${key}:${String(node.value ?? "")}`}
          node={node}
          execute={execute}
        />
      );
    case "select":
      return (
        <ExtensionSelectControl key={`${key}:${node.value ?? ""}`} node={node} execute={execute} />
      );
    case "toggle":
      return (
        <ExtensionToggleControl
          key={`${key}:${String(node.checked)}`}
          node={node}
          execute={execute}
        />
      );
    case "checkbox":
      return (
        <ExtensionCheckboxControl
          key={`${key}:${String(node.checked)}`}
          node={node}
          execute={execute}
        />
      );
    case "choice":
      return (
        <ExtensionChoiceControl
          key={`${key}:${JSON.stringify(node.value)}`}
          node={node}
          execute={execute}
        />
      );
    case "tabs":
      return (
        <ExtensionTabsControl
          key={`${key}:${node.value ?? ""}`}
          node={node}
          execute={execute}
          renderChildren={(children) =>
            children.map((child, index) => renderNode(child, execute, index, surface))
          }
        />
      );
    case "disclosure":
      return (
        <ExtensionDisclosureControl
          key={`${key}:${String(node.open)}`}
          node={node}
          execute={execute}
          renderChildren={(children) =>
            children.map((child, index) => renderNode(child, execute, index, surface))
          }
        />
      );
    case "keyValue":
      return (
        <dl
          key={key}
          className="grid min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 ui-text-sm"
        >
          {node.items.map((item, index) => (
            <Fragment key={`${item.label}-${index}`}>
              <dt className="truncate text-subtle-foreground">{item.label}</dt>
              <dd
                className={cn(
                  "min-w-0 wrap-break-word",
                  metricToneClassName(item.tone),
                  item.monospace && "font-mono",
                )}
              >
                {item.value}
              </dd>
            </Fragment>
          ))}
        </dl>
      );
    case "list":
      return (
        <div key={key} className="flex min-w-0 flex-col gap-0.5">
          {node.children.map((child, index) => renderNode(child, execute, index, surface))}
        </div>
      );
    case "tree":
      return <ExtensionViewTree key={key} node={node} execute={execute} />;
    case "listItem": {
      const trailing =
        node.meta || node.badges?.length ? (
          <span className="flex items-center gap-1">
            {node.badges?.map((badge) => (
              <Badge key={badge.label} variant={badgeTone(badge.tone)} size="compact">
                {badge.label}
              </Badge>
            ))}
            {node.meta}
          </span>
        ) : undefined;

      if (surface === "embedded") {
        return (
          <Item
            key={key}
            render={node.onSelect ? <button type="button" /> : undefined}
            variant="muted"
            size="xs"
            className="min-w-0 flex-nowrap text-left"
            onClick={() => node.onSelect && execute(node.onSelect)}
          >
            <ItemContent>
              <ItemTitle>{node.title}</ItemTitle>
              {node.description ? <ItemDescription>{node.description}</ItemDescription> : null}
            </ItemContent>
            {trailing ? <ItemActions>{trailing}</ItemActions> : null}
          </Item>
        );
      }

      return (
        <SidebarListItem
          key={key}
          description={node.description}
          trailing={trailing}
          disabled={!node.onSelect}
          onClick={() => node.onSelect && execute(node.onSelect)}
        >
          {node.title}
        </SidebarListItem>
      );
    }
    case "empty":
      return (
        <EmptyState
          key={key}
          layout={surface === "sidebar" ? "sidebar" : "default"}
          title={node.message}
          message={node.description}
        />
      );
    case "loading":
      return (
        <EmptyState
          key={key}
          layout={surface === "sidebar" ? "sidebar" : "default"}
          message={<Spinner label={node.message ?? "Loading"} showLabel compact />}
        />
      );
    case "error":
      return (
        <EmptyState
          key={key}
          layout={surface === "sidebar" ? "sidebar" : "default"}
          title={node.message}
          message={node.description}
          tone="error"
          role="alert"
        />
      );
    case "divider":
      return <div key={key} className="h-px bg-border/70" />;
    default:
      return <Fragment key={key} />;
  }
}

export function ExtensionViewRenderer({
  node,
  execute,
  surface = "sidebar",
}: ExtensionViewRendererProps) {
  return renderNode(node, execute, "root", surface);
}
