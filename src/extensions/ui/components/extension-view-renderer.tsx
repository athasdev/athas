import { Fragment } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import Input from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";
import { SidebarListItem, SidebarPanel, SidebarSectionLabel, SidebarTitleBar } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { DynamicIcon } from "./dynamic-icon";
import type {
  ExtensionViewAction,
  ExtensionViewNode,
  ExtensionViewTone,
} from "../types/extension-view";

interface ExtensionViewRendererProps {
  node: ExtensionViewNode;
  execute: (action: ExtensionViewAction, extraArgs?: unknown[]) => void;
}

const badgeTone = (tone: ExtensionViewTone | undefined) =>
  tone === "error" ? "error" : (tone ?? "default");

function renderNode(
  node: ExtensionViewNode,
  execute: ExtensionViewRendererProps["execute"],
  key: number | string,
) {
  switch (node.type) {
    case "screen":
      return (
        <SidebarPanel key={key}>
          {node.title || node.actions?.length ? (
            <SidebarTitleBar title={node.title ?? ""}>
              {node.actions?.map((item) => (
                <Button
                  key={item.label}
                  size="icon-xs"
                  variant="ghost"
                  tooltip={item.label}
                  onClick={() => execute(item.action)}
                >
                  {item.icon ? <DynamicIcon name={item.icon} size={14} /> : item.label}
                </Button>
              ))}
            </SidebarTitleBar>
          ) : null}
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-2 p-2">
              {node.children.map((child, index) => renderNode(child, execute, index))}
            </div>
          </ScrollArea>
        </SidebarPanel>
      );
    case "stack":
      return (
        <div key={key} className="flex flex-col gap-2">
          {node.children.map((child, index) => renderNode(child, execute, index))}
        </div>
      );
    case "row":
      return (
        <div key={key} className="flex min-w-0 items-center gap-2">
          {node.children.map((child, index) => renderNode(child, execute, index))}
        </div>
      );
    case "section":
      return (
        <section key={key} className="min-w-0">
          <SidebarSectionLabel>{node.title}</SidebarSectionLabel>
          <div className="flex flex-col gap-0.5">
            {node.children.map((child, index) => renderNode(child, execute, index))}
          </div>
        </section>
      );
    case "text":
      return (
        <p
          key={key}
          className={
            node.tone === "error"
              ? "ui-text-sm text-destructive"
              : "ui-text-sm text-subtle-foreground"
          }
        >
          {node.value}
        </p>
      );
    case "badge":
      return (
        <Badge key={key} variant={badgeTone(node.tone)} size="compact">
          {node.label}
        </Badge>
      );
    case "button":
      return (
        <Button
          key={key}
          size="sm"
          variant={node.tone ?? "default"}
          disabled={node.disabled}
          onClick={() => execute(node.action)}
        >
          {node.label}
        </Button>
      );
    case "input":
      return (
        <label key={key} className="flex min-w-0 flex-col gap-1 ui-text-sm text-subtle-foreground">
          {node.label ? <span>{node.label}</span> : null}
          <Input
            value={node.value ?? ""}
            placeholder={node.placeholder}
            type={node.inputType ?? "text"}
            onChange={(event) => execute(node.onChange, [event.currentTarget.value])}
          />
        </label>
      );
    case "list":
      return (
        <div key={key} className="flex min-w-0 flex-col gap-0.5">
          {node.children.map((child, index) => renderNode(child, execute, index))}
        </div>
      );
    case "listItem":
      return (
        <SidebarListItem
          key={key}
          description={node.description}
          trailing={
            node.meta || node.badges?.length ? (
              <span className="flex items-center gap-1">
                {node.badges?.map((badge) => (
                  <Badge key={badge.label} variant={badgeTone(badge.tone)} size="compact">
                    {badge.label}
                  </Badge>
                ))}
                {node.meta}
              </span>
            ) : undefined
          }
          disabled={!node.onSelect}
          onClick={() => node.onSelect && execute(node.onSelect)}
        >
          {node.title}
        </SidebarListItem>
      );
    case "empty":
      return (
        <Empty key={key}>
          <EmptyHeader>
            <EmptyTitle>{node.message}</EmptyTitle>
            {node.description ? <EmptyDescription>{node.description}</EmptyDescription> : null}
          </EmptyHeader>
        </Empty>
      );
    case "loading":
      return (
        <div
          key={key}
          className="flex items-center justify-center gap-2 py-8 ui-text-sm text-subtle-foreground"
        >
          <Spinner compact />
          {node.message ?? "Loading"}
        </div>
      );
    case "error":
      return (
        <Empty key={key} tone="error" role="alert">
          <EmptyHeader>
            <EmptyTitle>{node.message}</EmptyTitle>
            {node.description ? <EmptyDescription>{node.description}</EmptyDescription> : null}
          </EmptyHeader>
        </Empty>
      );
    case "divider":
      return <div key={key} className="h-px bg-border/70" />;
    default:
      return <Fragment key={key} />;
  }
}

export function ExtensionViewRenderer({ node, execute }: ExtensionViewRendererProps) {
  return renderNode(node, execute, "root");
}
