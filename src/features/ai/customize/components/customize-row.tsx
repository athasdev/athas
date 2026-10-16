import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  type MenuItem,
} from "@/ui/dropdown";
import { DotsIcon, PlusIcon } from "@/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/item";
import { Spinner } from "@/ui/spinner";
import type { CustomizeBrand } from "../types/customize.types";
import { CustomizeMark } from "./customize-mark";

/**
 * One entry of a Customize grid: the brand tile, the name over one line of description, and the
 * row's action. A revealed row scrolls into view and keeps a quiet fill until the next reveal.
 */
export function CustomizeRow({
  title,
  description,
  brand,
  media,
  status,
  action,
  revealed = false,
}: {
  title: string;
  description: ReactNode;
  brand?: CustomizeBrand;
  /** Art that is not a brand mark, such as a theme preview, in place of `brand`. */
  media?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
  revealed?: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (revealed) rowRef.current?.scrollIntoView({ block: "center" });
  }, [revealed]);

  return (
    <Item ref={rowRef} role="listitem" size="comfortable" variant={revealed ? "muted" : "default"}>
      <ItemMedia variant="tile">
        {media ?? (
          <CustomizeMark
            brand={brand}
            size="tile"
            fallback={<span aria-hidden="true">{title.trim().charAt(0).toUpperCase() || "?"}</span>}
          />
        )}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <span className="truncate">{title}</span>
          {status}
        </ItemTitle>
        <ItemDescription lines={1}>{description}</ItemDescription>
      </ItemContent>
      {action ? <ItemActions>{action}</ItemActions> : null}
    </Item>
  );
}

export function CustomizeAddButton({
  label,
  busy = false,
  busyLabel = "Installing",
  onClick,
}: {
  label: string;
  busy?: boolean;
  busyLabel?: string;
  onClick: () => void;
}) {
  if (busy) return <Spinner compact label={busyLabel} />;
  return (
    <Button type="button" variant="ghost" iconOnly tooltip={label} onClick={onClick}>
      <PlusIcon />
    </Button>
  );
}

export function CustomizeMoreMenu({
  label,
  items,
  busy = false,
  busyLabel = "Working",
}: {
  label: string;
  items: MenuItem[];
  busy?: boolean;
  busyLabel?: string;
}) {
  if (busy) return <Spinner compact label={busyLabel} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" iconOnly tooltip={label} />}
      >
        <DotsIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItems items={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A short muted word in place of an action, such as why a row cannot be added. */
export function CustomizeRowNote({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="shrink-0 text-subtle-foreground ui-text-sm">
      {children}
    </span>
  );
}
