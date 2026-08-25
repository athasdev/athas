import type React from "react";
import { useMemo, useState } from "react";
import { SidebarTree, SidebarTreeRow } from "@/features/sidebar/components/sidebar-tree";
import Badge from "@/ui/badge";
import { DynamicIcon } from "./dynamic-icon";
import type { ExtensionViewExecute } from "./extension-view-controls";
import type { ExtensionViewNode, ExtensionViewTreeItem } from "../types/extension-view";

type TreeNode = Extract<ExtensionViewNode, { type: "tree" }>;

function collectExpandedItems(items: ExtensionViewTreeItem[], expanded: Set<string>): void {
  for (const item of items) {
    if (item.expanded && item.children?.length) expanded.add(item.id);
    if (item.children) collectExpandedItems(item.children, expanded);
  }
}

export function ExtensionViewTree({
  node,
  execute,
}: {
  node: TreeNode;
  execute: ExtensionViewExecute;
}) {
  const initiallyExpanded = useMemo(() => {
    const expanded = new Set<string>();
    collectExpandedItems(node.items, expanded);
    return expanded;
  }, [node.items]);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [selectedId, setSelectedId] = useState<string>();

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderItems = (items: ExtensionViewTreeItem[], depth: number): React.ReactNode =>
    items.map((item) => {
      const hasChildren = Boolean(item.children?.length);
      const isExpanded = hasChildren && expanded.has(item.id);
      const trailing =
        item.meta || item.badges?.length ? (
          <span className="flex min-w-0 items-center gap-1">
            {item.badges?.map((badge, index) => (
              <Badge
                key={`${badge.label}-${index}`}
                variant={badge.tone === "error" ? "error" : (badge.tone ?? "default")}
                size="compact"
              >
                {badge.label}
              </Badge>
            ))}
            {item.meta ? (
              <span className="truncate text-subtle-foreground">{item.meta}</span>
            ) : null}
          </span>
        ) : undefined;

      return (
        <div key={item.id}>
          <SidebarTreeRow
            depth={depth}
            active={selectedId === item.id}
            expanded={hasChildren ? isExpanded : undefined}
            reserveDisclosureSpace={!hasChildren}
            label={item.title}
            description={item.description}
            leading={item.icon ? <DynamicIcon name={item.icon} size={14} /> : undefined}
            trailing={trailing}
            onToggle={() => toggle(item.id)}
            onClick={() => {
              setSelectedId(item.id);
              if (item.onSelect) {
                void execute(item.onSelect);
              } else if (hasChildren) {
                toggle(item.id);
              }
            }}
          />
          {isExpanded && item.children ? renderItems(item.children, depth + 1) : null}
        </div>
      );
    });

  return <SidebarTree label={node.label}>{renderItems(node.items, 0)}</SidebarTree>;
}
