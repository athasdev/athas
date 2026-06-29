import { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";

interface TypedConfirmActionProps {
  actionLabel: string;
  confirmWord?: string;
  busyLabel?: string;
  isBusy?: boolean;
  onConfirm: () => void | Promise<void>;
  variant?: "default" | "danger";
  tooltip?: string;
}

export function TypedConfirmAction({
  actionLabel,
  confirmWord = "yes",
  busyLabel,
  isBusy = false,
  onConfirm,
  variant = "default",
  tooltip,
}: TypedConfirmActionProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isConfirming) {
      setValue("");
      return;
    }

    const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timeoutId);
  }, [isConfirming]);

  const handleConfirm = async () => {
    await onConfirm();
    setIsConfirming(false);
    setValue("");
  };

  if (isConfirming) {
    return (
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          data-prevent-dialog-escape="true"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={`Type '${confirmWord}'`}
          size="md"
          variant="default"
          className="w-28"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setIsConfirming(false);
              return;
            }

            if (event.key === "Enter" && value.trim().toLowerCase() === confirmWord) {
              event.preventDefault();
              void handleConfirm();
            }
          }}
        />
        <Button
          type="button"
          variant={variant}
          disabled={isBusy || value.trim().toLowerCase() !== confirmWord}
          onClick={() => void handleConfirm()}
          compact
        >
          {isBusy ? (busyLabel ?? actionLabel) : actionLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setIsConfirming(false)} compact>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      disabled={isBusy}
      onClick={() => setIsConfirming(true)}
      tooltip={tooltip}
      compact
    >
      {isBusy ? (busyLabel ?? actionLabel) : actionLabel}
    </Button>
  );
}
