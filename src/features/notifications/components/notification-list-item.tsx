import type React from "react";
import { forwardRef } from "react";
import { NotificationIcon } from "@/features/notifications/components/notification-icon";
import type { NotificationItemAction } from "@/features/notifications/types/notifications.types";
import { Button } from "@/ui/button";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/ui/item";
import type { NotificationEntry } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";

interface NotificationListItemProps {
  notification: NotificationEntry;
  actions: NotificationItemAction[];
  onContextMenu: (event: React.MouseEvent, notification: NotificationEntry) => void;
  selected?: boolean;
  tabIndex?: number;
  onClick?: () => void;
  onFocus?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export const NotificationListItem = forwardRef<HTMLDivElement, NotificationListItemProps>(
  function NotificationListItem(
    {
      notification,
      actions,
      onContextMenu,
      selected = false,
      tabIndex,
      onClick,
      onFocus,
      onKeyDown,
    },
    ref,
  ) {
    return (
      <Item
        ref={ref}
        role="button"
        tabIndex={tabIndex}
        size="xs"
        variant={selected ? "muted" : "default"}
        className="relative h-7 flex-nowrap select-none rounded-lg px-2 py-0 hover:bg-hover/45 focus-visible:bg-hover/45 focus-visible:ring-0"
        onClick={onClick}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => onContextMenu(event, notification)}
      >
        <ItemMedia variant="icon">
          <NotificationIcon type={notification.type} />
        </ItemMedia>
        <ItemContent className="min-w-0 overflow-hidden group-hover/item:pr-7 group-focus-within/item:pr-7">
          <ItemTitle className="ui-font ui-text-sm block w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-text">
            {notification.message}
          </ItemTitle>
        </ItemContent>
        <ItemActions className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 gap-1 opacity-0 transition-opacity group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100">
          {actions.map((action) => (
            <Tooltip key={action.id} content={action.label} side="bottom" triggerClassName="size-6">
              <Button
                type="button"
                variant={action.variant === "danger" ? "danger" : "ghost"}
                compact
                className="size-5 min-h-5 min-w-5 bg-transparent px-0 text-text-lighter"
                aria-label={action.label}
                onClick={(event) => {
                  event.stopPropagation();
                  action.onSelect();
                }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {action.icon}
              </Button>
            </Tooltip>
          ))}
        </ItemActions>
      </Item>
    );
  },
);
