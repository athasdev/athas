import { motion } from "framer-motion";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="w-80 rounded-lg border border-border bg-secondary-bg p-4"
      >
        <h3 className="mb-3 font-medium text-sm text-text">{title}</h3>
        <Input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          className={cn("mb-4 w-full bg-primary-bg text-sm")}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="flex justify-end gap-2">
          <Button
            onClick={onClose}
            variant="ghost"
            size="sm"
            className="text-text-lighter text-xs hover:text-text"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            variant="primary"
            size="sm"
            className="text-xs disabled:opacity-50"
          >
            {isLoading ? "Stashing..." : "Stash"}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};
