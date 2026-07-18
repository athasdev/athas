import { Dialog as DialogPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
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
import { instantTransition, overlayEntrance, quickTransition } from "@/utils/motion-presets";
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
    "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[9999]",
    "flex max-h-[90vh] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-primary-bg shadow-[var(--shadow-dialog)]",
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

const Dialog = ({
  children,
  onClose,
  title,
  icon: Icon,
  headerActions,
  footer,
  size = "md",
  classNames,
}: DialogProps) => {
  const prefersReducedMotion = useReducedMotion();
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
          className={cn("fixed inset-0 z-[9998] bg-black/20", classNames?.backdrop)}
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
              "flex shrink-0 items-center justify-between bg-primary-bg px-4 py-3",
              classNames?.header,
            )}
          >
            <div className={cn("flex min-w-0 items-center gap-2", classNames?.title)}>
              {Icon && <Icon className="text-text-lighter" />}
              <DialogPrimitive.Title className="min-w-0 font-sans ui-text-base font-medium text-text">
                {title}
              </DialogPrimitive.Title>
            </div>

            <div className={cn("flex items-center gap-1", classNames?.headerActions)}>
              {headerActions}
              <DialogPrimitive.Close
                className="flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-text-lighter transition-[transform,background-color,border-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:border-border/70 hover:bg-hover hover:text-text active:scale-[var(--app-press-scale)]"
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
      <Dialog
        title={dialog.title}
        icon={Info}
        onClose={() => onClose(dialog.resolve)}
        size="sm"
        footer={
          <Button variant="accent" onClick={() => onClose(dialog.resolve)}>
            OK
          </Button>
        }
      >
        <div className="whitespace-pre-wrap ui-text-sm text-text">{dialog.message}</div>
      </Dialog>
    );
  }

  if (dialog.type === "confirm") {
    return (
      <Dialog
        title={dialog.title}
        icon={Question}
        onClose={() => onClose(() => dialog.resolve(false))}
        size="sm"
        footer={
          <>
            <Button variant="default" onClick={() => onClose(() => dialog.resolve(false))}>
              {dialog.cancelLabel}
            </Button>
            <Button variant="accent" onClick={() => onClose(() => dialog.resolve(true))}>
              {dialog.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="whitespace-pre-wrap ui-text-sm text-text">{dialog.message}</div>
      </Dialog>
    );
  }

  if (dialog.type === "choice") {
    return (
      <Dialog
        title={dialog.title}
        icon={Warning}
        onClose={() => onClose(() => dialog.resolve(null))}
        size="sm"
        footer={
          <>
            {dialog.choices.map((choice) => (
              <Button
                key={choice.value}
                variant={choice.variant ?? "default"}
                onClick={() => onClose(() => dialog.resolve(choice.value))}
              >
                {choice.label}
              </Button>
            ))}
          </>
        }
      >
        <div className="whitespace-pre-wrap ui-text-sm text-text">{dialog.message}</div>
      </Dialog>
    );
  }

  return (
    <Dialog
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
        <label className="flex flex-col gap-2 font-sans ui-text-sm text-text">
          {dialog.message}
          <Input
            autoFocus
            value={promptValue}
            placeholder={dialog.placeholder}
            onChange={(event) => setPromptValue(event.target.value)}
          />
        </label>
      </form>
    </Dialog>
  );
}

export default Dialog;
