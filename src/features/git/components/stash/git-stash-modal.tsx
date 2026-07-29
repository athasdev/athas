import { useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
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
  if (!isOpen) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <StashMessageModalContent
        onClose={onClose}
        onConfirm={onConfirm}
        title={title}
        placeholder={placeholder}
      />
    </Dialog>
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

  return (
    <DialogContent
      aria-describedby={undefined}
      size="sm"
      showCloseButton={false}
      className="max-w-80 p-0"
    >
      <DialogHeader className="px-4 pt-4">
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="px-4 py-3">
        <Input
          autoFocus
          type="text"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={placeholder}
          className={cn("w-full bg-background ui-text-sm")}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleConfirm();
          }}
        />
      </div>
      <DialogFooter>
        <Button
          onClick={onClose}
          variant="ghost"
          className="text-subtle-foreground ui-text-sm hover:text-foreground"
          size="xs"
        >
          Cancel
        </Button>
        <Button
          onClick={() => void handleConfirm()}
          disabled={isLoading}
          variant="accent"
          className="ui-text-sm disabled:opacity-50"
          size="xs"
        >
          {isLoading ? "Stashing..." : "Stash"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};
