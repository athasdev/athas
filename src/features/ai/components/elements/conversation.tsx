import {
  ArrowDownIcon as ArrowDown,
  ChatCircleTextIcon as MessageSquare,
} from "@phosphor-icons/react";
import {
  forwardRef,
  type ComponentProps,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

export const Conversation = forwardRef<HTMLDivElement, ComponentProps<"div">>(function Conversation(
  { className, children, onScroll, ...props },
  ref,
) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const setRefs = (node: HTMLDivElement | null) => {
    localRef.current = node;
    if (typeof ref === "function") {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  };

  const updateScrollState = () => {
    const element = localRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsAtBottom(distanceFromBottom < 48);
  };

  useEffect(() => {
    updateScrollState();
  }, [children]);

  return (
    <div
      data-ai-element="conversation"
      className={cn("relative z-0 flex min-h-0 flex-1", className)}
      data-at-bottom={isAtBottom}
    >
      <div
        ref={setRefs}
        data-ai-element="conversation-scrollport"
        onScroll={(event) => {
          updateScrollState();
          onScroll?.(event);
        }}
        className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto"
        {...props}
      >
        {children}
      </div>
      <ConversationScrollButton
        visible={!isAtBottom}
        onClick={() => {
          localRef.current?.scrollTo({
            top: localRef.current.scrollHeight,
            behavior: "smooth",
          });
        }}
      />
    </div>
  );
});

export function ConversationContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-ai-element="conversation-content"
      className={cn("flex min-h-full flex-col", className)}
      {...props}
    />
  );
}

export function ConversationEmptyState({
  title,
  description,
  icon,
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      data-ai-element="conversation-empty-state"
      className={cn("flex h-full flex-col items-center justify-end px-4 pb-2 pt-4", className)}
      {...props}
    >
      {children ? (
        children
      ) : (
        <div className="flex max-w-sm flex-col items-center text-center">
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg border border-border/70 bg-secondary-bg text-text-lighter">
            {icon ?? <MessageSquare className="size-4" />}
          </div>
          {title ? <p className="font-medium text-text ui-text-sm">{title}</p> : null}
          {description ? <p className="mt-1 text-text-lighter ui-text-xs">{description}</p> : null}
        </div>
      )}
    </div>
  );
}

export function ConversationScrollButton({
  visible = true,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  visible?: boolean;
}) {
  if (!visible) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      compact
      tooltip="Scroll to latest message"
      className={cn(
        "absolute right-3 bottom-3 z-10 size-7 rounded-full border border-border/70 bg-primary-bg/95 p-0 text-text-lighter shadow-[var(--shadow-popover)] hover:bg-hover hover:text-text",
        className,
      )}
      {...props}
    >
      <ArrowDown className="size-3.5" />
    </Button>
  );
}
