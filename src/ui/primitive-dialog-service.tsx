import { Info, Question, Warning } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";

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

export function primitiveAlert(message: ReactNode, title = "Notice"): Promise<void> {
  return new Promise((resolve) => {
    enqueue({ id: nextDialogId++, type: "alert", title, message, resolve });
  });
}

export function primitiveConfirm(
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

export function primitiveChoice<T extends string>(
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

export function primitivePrompt(
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

export function PrimitiveDialogProvider({ children }: { children: ReactNode }) {
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
          <Button variant="primary" size="sm" onClick={() => onClose(dialog.resolve)}>
            OK
          </Button>
        }
      >
        <div className="whitespace-pre-wrap text-text text-xs">{dialog.message}</div>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => onClose(() => dialog.resolve(false))}
            >
              {dialog.cancelLabel}
            </Button>
            <Button variant="primary" size="sm" onClick={() => onClose(() => dialog.resolve(true))}>
              {dialog.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="whitespace-pre-wrap text-text text-xs">{dialog.message}</div>
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
                variant={choice.variant ?? "outline"}
                size="sm"
                onClick={() => onClose(() => dialog.resolve(choice.value))}
              >
                {choice.label}
              </Button>
            ))}
          </>
        }
      >
        <div className="whitespace-pre-wrap text-text text-xs">{dialog.message}</div>
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
          <Button variant="outline" size="sm" onClick={() => onClose(() => dialog.resolve(null))}>
            {dialog.cancelLabel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onClose(() => dialog.resolve(promptValue))}
          >
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
        <label className="flex flex-col gap-2 ui-font ui-text-sm text-text">
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
