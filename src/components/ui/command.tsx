import type * as React from "react";
import { cn } from "../../utils/cn";

interface CommandProps extends React.HTMLAttributes<HTMLDivElement> {
  shouldFilter?: boolean;
}

function Command({ className, shouldFilter, ...props }: CommandProps) {
  return (
    <div
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

interface CommandInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onValueChange?: (value: string) => void;
}

function CommandInput({ className, onValueChange, onChange, ...props }: CommandInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onValueChange) {
      onValueChange(e.target.value);
    }
    if (onChange) {
      onChange(e);
    }
  };

  return (
    <div data-slot="command-input-wrapper" className="flex h-9 items-center gap-2 px-3">
      <input
        data-slot="command-input"
        className={cn(
          "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        onChange={handleChange}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="command-list"
      className={cn("max-h-[300px] scroll-py-1 overflow-y-auto overflow-x-hidden", className)}
      {...props}
    />
  );
}

function CommandEmpty({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="command-empty" className={cn("py-6 text-center text-sm", className)} {...props}>
      {children}
    </div>
  );
}

function CommandGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="command-group"
      className={cn("overflow-hidden p-1 text-foreground", className)}
      {...props}
    />
  );
}

function CommandSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  );
}

interface CommandItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value?: string;
  onSelect?: () => void;
}

function CommandItem({ className, onSelect, onClick, ...props }: CommandItemProps) {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (onSelect) {
      onSelect();
    }
    if (onClick) {
      onClick(e);
    }
  };

  return (
    <button
      data-slot="command-item"
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      onClick={handleClick}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("ml-auto text-muted-foreground text-xs tracking-widest", className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
