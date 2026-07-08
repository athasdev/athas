import { motion, useReducedMotion } from "framer-motion";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { instantTransition, overlayEntrance, overlayTransition } from "@/ui/motion";
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
  if (!isOpen) return null;

  return (
    <StashMessageModalContent
      onClose={onClose}
      onConfirm={onConfirm}
      title={title}
      placeholder={placeholder}
    />
  );
};

const StashMessageModalContent = ({
  onClose,
  onConfirm,
  title,
  placeholder,
}: Omit<StashMessageModalProps, "isOpen">) => {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useOnClickOutside(modalRef as RefObject<HTMLElement>, onClose);

  useEffect(() => {
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, []);

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

  return createPortal(
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={prefersReducedMotion ? instantTransition : overlayTransition}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <motion.div
        ref={modalRef}
        initial={prefersReducedMotion ? false : overlayEntrance.initial}
        animate={overlayEntrance.animate}
        transition={prefersReducedMotion ? instantTransition : overlayEntrance.transition}
        className="w-80 rounded-[var(--app-radius-menu)] border border-border bg-secondary-bg p-4 shadow-[var(--shadow-dialog)]"
      >
        <h3 className="mb-3 font-medium ui-text-sm text-text">{title}</h3>
        <Input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          className={cn("mb-4 w-full bg-primary-bg ui-text-sm")}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="flex justify-end gap-2">
          <Button
            onClick={onClose}
            variant="ghost"
            className="text-text-lighter ui-text-sm hover:text-text"
            compact
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            variant="accent"
            className="ui-text-sm disabled:opacity-50"
            compact
          >
            {isLoading ? "Stashing..." : "Stash"}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};
