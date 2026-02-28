import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { cn } from "@/utils/cn";

interface StashMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (message: string) => Promise<void>;
  title?: string;
  placeholder?: string;
}

export const StashMessageModal = ({
  isOpen,
  onClose,
  onConfirm,
  title = "Create Stash",
  placeholder = "Stash message...",
}: StashMessageModalProps) => {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useOnClickOutside(modalRef as RefObject<HTMLElement>, onClose);

  useEffect(() => {
    if (isOpen) {
      setMessage("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm(message);
      onClose();
    } catch (error) {
      console.error("Failed to create stash:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={modalRef}
        className={cn(
          "w-80 rounded-lg border border-border bg-secondary-bg p-4",
          "fade-in zoom-in-95 animate-in duration-200",
        )}
      >
        <h3 className="mb-3 font-medium text-sm text-text">{title}</h3>
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "mb-4 w-full rounded border border-border bg-primary-bg px-2 py-1.5",
            "text-sm text-text focus:border-blue-500 focus:outline-none",
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-text-lighter text-xs hover:bg-hover hover:text-text"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className={cn(
              "rounded bg-blue-600 px-3 py-1 text-white text-xs",
              "hover:bg-blue-700 disabled:opacity-50",
            )}
          >
            {isLoading ? "Stashing..." : "Stash"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
