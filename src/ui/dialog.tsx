import { Dialog as DialogPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import { motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button, type ButtonVariant } from "@/ui/button";
import {
  InfoIcon as Info,
  type IconProps as AppIconProps,
  QuestionIcon as Question,
  WarningIcon as Warning,
  XIcon as X,
} from "@/ui/icons";
import Input from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";
import { instantTransition, overlayEntrance, quickTransition } from "@/utils/motion";
import { resolveEscapeGuard } from "@/utils/keyboard/escape-guard";
import { cn } from "@/utils/cn";

interface DialogProps {
  children: ReactNode;
  onClose: () => void;
  title: ReactNode;
  icon?: React.ForwardRefExoticComponent<
    Omit<AppIconProps, "ref"> & React.RefAttributes<SVGSVGElement>
  >;
  headerActions?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  headerBorder?: boolean;
  footerBorder?: boolean;
  classNames?: Partial<{
    backdrop: string;
    modal: string;
    header: string;
    title: string;
    headerActions: string;
    content: string;
  }>;
}

const dialogContentVariants = cva(
  [
    "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-9999",
    "flex max-h-[90vh] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-(--shadow-dialog)",
    "focus:outline-none",
  ],
  {
    variants: {
      size: {
        sm: "w-full max-w-sm",
        md: "w-full max-w-md",
        lg: "w-full max-w-lg",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-9998 bg-black/20 transition-opacity duration-(--app-duration-fast) data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  size = "md",
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  size?: "sm" | "md" | "lg";
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          dialogContentVariants({ size }),
          "transition-[opacity,transform,filter] duration-(--app-duration-fast) ease-(--app-ease-smooth) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            render={<Button variant="ghost" size="icon-xs" />}
            className="absolute top-2.5 right-2.5 text-subtle-foreground hover:text-foreground"
            aria-label="Close dialog"
          >
            <X />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 px-4 pt-4", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-border/70 border-t bg-surface/55 px-4 py-3 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-sans ui-text-base font-medium leading-snug text-foreground", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("font-sans ui-text-sm leading-normal text-subtle-foreground", className)}
      {...props}
    />
  );
}

const AppDialog = ({
  children,
  onClose,
  title,
  icon: Icon,
  headerActions,
  footer,
  size = "md",
  classNames,
}: DialogProps) => {
  const prefersReducedMotion = useReducedMotionConfig();
  const popupMotion = prefersReducedMotion
    ? {
        initial: false as const,
        animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
        exit: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
        transition: instantTransition,
      }
    : overlayEntrance;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return;

        if (eventDetails.reason === "escape-key") {
          const target = eventDetails.event.target as HTMLElement | null;
          const activeElement =
            typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
          const { dismissTarget, blurTarget } = resolveEscapeGuard(target, activeElement);

          if (dismissTarget) {
            eventDetails.cancel();
            return;
          }

          if (blurTarget) {
            eventDetails.cancel();
            blurTarget.blur();
            return;
          }
        }

        onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          render={
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={prefersReducedMotion ? instantTransition : quickTransition}
            />
          }
          className={cn("fixed inset-0 z-9998 bg-black/20", classNames?.backdrop)}
        />

        <DialogPrimitive.Popup
          aria-describedby={undefined}
          render={
            <motion.div
              initial={popupMotion.initial}
              animate={popupMotion.animate}
              exit={popupMotion.exit}
              transition={popupMotion.transition}
            />
          }
          data-dialog-content=""
          className={cn(dialogContentVariants({ size }), classNames?.modal)}
        >
          <div
            className={cn(
              "flex shrink-0 items-center justify-between bg-background px-4 py-3",
              classNames?.header,
            )}
          >
            <div className={cn("flex min-w-0 items-center gap-2", classNames?.title)}>
              {Icon && <Icon className="text-subtle-foreground" />}
              <DialogPrimitive.Title className="min-w-0 font-sans ui-text-base font-medium text-foreground">
                {title}
              </DialogPrimitive.Title>
            </div>

            <div className={cn("flex items-center gap-1", classNames?.headerActions)}>
              {headerActions}
              <DialogPrimitive.Close
                className="flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-subtle-foreground transition-[transform,background-color,border-color,color] duration-(--app-duration-fast) ease-(--app-ease-smooth) hover:border-border/70 hover:bg-accent hover:text-foreground active:scale-(--app-press-scale)"
                aria-label="Close dialog"
              >
                <X />
              </DialogPrimitive.Close>
            </div>
          </div>

          <ScrollArea className="flex-1" contentClassName={cn("p-4", classNames?.content)}>
            {children}
          </ScrollArea>

          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-3">{footer}</div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

interface PrimitiveChoiceOption {
  value: string;
  label: string;
  variant?: ButtonVariant;
}

type PrimitiveDialogRequest =
  | {
      id: number;
      type: "alert";
      title: string;
      message: ReactNode;
      resolve: () => void;
    }
  | {
      id: number;
      type: "confirm";
      title: string;
      message: ReactNode;
      confirmLabel: string;
      cancelLabel: string;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      type: "choice";
      title: string;
      message: ReactNode;
      choices: PrimitiveChoiceOption[];
      resolve: (value: string | null) => void;
    }
  | {
      id: number;
      type: "prompt";
      title: string;
      message: ReactNode;
      defaultValue: string;
      placeholder?: string;
      confirmLabel: string;
      cancelLabel: string;
      resolve: (value: string | null) => void;
    };

interface PrimitiveConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface PrimitivePromptOptions extends PrimitiveConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
}

interface PrimitiveChoiceOptions<T extends string> {
  title?: string;
  choices: Array<{
    value: T;
    label: string;
    variant?: ButtonVariant;
  }>;
}

let nextDialogId = 1;
let enqueueDialog: ((request: PrimitiveDialogRequest) => void) | null = null;
const pendingDialogs: PrimitiveDialogRequest[] = [];

function enqueue(request: PrimitiveDialogRequest) {
  if (enqueueDialog) {
    enqueueDialog(request);
    return;
  }

  pendingDialogs.push(request);
}

export function showAlertDialog(message: ReactNode, title = "Notice"): Promise<void> {
  return new Promise((resolve) => {
    enqueue({ id: nextDialogId++, type: "alert", title, message, resolve });
  });
}

export function showConfirmDialog(
  message: ReactNode,
  options: PrimitiveConfirmOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({
      id: nextDialogId++,
      type: "confirm",
      title: options.title ?? "Confirm",
      message,
      confirmLabel: options.confirmLabel ?? "Confirm",
      cancelLabel: options.cancelLabel ?? "Cancel",
      resolve,
    });
  });
}

export function showChoiceDialog<T extends string>(
  message: ReactNode,
  options: PrimitiveChoiceOptions<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    enqueue({
      id: nextDialogId++,
      type: "choice",
      title: options.title ?? "Choose",
      message,
      choices: options.choices,
      resolve: (value) => resolve(value as T | null),
    });
  });
}

export function showPromptDialog(
  message: ReactNode,
  options: PrimitivePromptOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({
      id: nextDialogId++,
      type: "prompt",
      title: options.title ?? "Input",
      message,
      defaultValue: options.defaultValue ?? "",
      placeholder: options.placeholder,
      confirmLabel: options.confirmLabel ?? "OK",
      cancelLabel: options.cancelLabel ?? "Cancel",
      resolve,
    });
  });
}

export function DialogServiceProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PrimitiveDialogRequest[]>([]);

  useEffect(() => {
    enqueueDialog = (request) => setQueue((current) => [...current, request]);

    if (pendingDialogs.length > 0) {
      setQueue((current) => [...current, ...pendingDialogs.splice(0)]);
    }

    return () => {
      enqueueDialog = null;
    };
  }, []);

  const activeDialog = queue[0] ?? null;
  const closeActive = (resolve: () => void) => {
    resolve();
    setQueue((current) => current.slice(1));
  };

  return (
    <>
      {children}
      {activeDialog && (
        <PrimitiveDialogHost key={activeDialog.id} dialog={activeDialog} onClose={closeActive} />
      )}
    </>
  );
}

function PrimitiveDialogHost({
  dialog,
  onClose,
}: {
  dialog: PrimitiveDialogRequest;
  onClose: (resolve: () => void) => void;
}) {
  const [promptValue, setPromptValue] = useState(
    dialog.type === "prompt" ? dialog.defaultValue : "",
  );

  if (dialog.type === "alert") {
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose(dialog.resolve);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Info />
            </AlertDialogMedia>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialog.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid-cols-1">
            <AlertDialogAction variant="accent" onClick={() => onClose(dialog.resolve)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (dialog.type === "confirm") {
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose(() => dialog.resolve(false));
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Question />
            </AlertDialogMedia>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialog.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{dialog.cancelLabel}</AlertDialogCancel>
            <AlertDialogAction variant="accent" onClick={() => onClose(() => dialog.resolve(true))}>
              {dialog.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (dialog.type === "choice") {
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose(() => dialog.resolve(null));
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Warning />
            </AlertDialogMedia>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialog.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {dialog.choices.map((choice) => (
              <AlertDialogAction
                key={choice.value}
                variant={choice.variant ?? "default"}
                onClick={() => onClose(() => dialog.resolve(choice.value))}
              >
                {choice.label}
              </AlertDialogAction>
            ))}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AppDialog
      title={dialog.title}
      icon={Warning}
      onClose={() => onClose(() => dialog.resolve(null))}
      size="sm"
      footer={
        <>
          <Button variant="default" onClick={() => onClose(() => dialog.resolve(null))}>
            {dialog.cancelLabel}
          </Button>
          <Button variant="accent" onClick={() => onClose(() => dialog.resolve(promptValue))}>
            {dialog.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onClose(() => dialog.resolve(promptValue));
        }}
        className="flex flex-col gap-2"
      >
        <label className="flex flex-col gap-2 font-sans ui-text-sm text-foreground">
          {dialog.message}
          <Input
            autoFocus
            value={promptValue}
            placeholder={dialog.placeholder}
            onChange={(event) => setPromptValue(event.target.value)}
          />
        </label>
      </form>
    </AppDialog>
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};

export default AppDialog;
