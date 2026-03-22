import { cva } from "class-variance-authority";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Regex,
  Replace,
  Search,
  WholeWord,
  X,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";

export interface SearchToggleOption {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onToggle: () => void;
}

interface SearchPopoverProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onClose: () => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  matchLabel?: string | null;
  onNext?: () => void;
  onPrevious?: () => void;
  canNavigate?: boolean;
  options?: SearchToggleOption[];
  leadingControl?: ReactNode;
  extraActions?: ReactNode;
  secondaryRow?: ReactNode;
  className?: string;
}

const searchSurfaceVariants = cva(
  "w-[320px] rounded-xl border border-border/70 bg-primary-bg/95 p-1.5 shadow-[0_16px_36px_-28px_rgba(0,0,0,0.55)] backdrop-blur-sm",
);

const searchIconButtonVariants = cva(
  "flex h-6 w-6 items-center justify-center rounded-lg border border-transparent text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text",
  {
    variants: {
      disabled: {
        true: "cursor-not-allowed opacity-50",
        false: "",
      },
    },
    defaultVariants: {
      disabled: false,
    },
  },
);

const searchToggleButtonVariants = cva(
  "flex h-6 w-6 items-center justify-center rounded-lg border border-transparent transition-colors hover:border-border/70 hover:bg-hover",
  {
    variants: {
      active: {
        true: "border-border/70 bg-hover text-text",
        false: "text-text-lighter",
      },
    },
    defaultVariants: {
      active: false,
    },
  },
);

const searchActionButtonVariants = cva(
  "ui-font flex h-8 items-center justify-center rounded-lg border border-transparent px-2.5 text-xs text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text",
  {
    variants: {
      disabled: {
        true: "cursor-not-allowed opacity-50",
        false: "",
      },
    },
    defaultVariants: {
      disabled: false,
    },
  },
);

export function SearchPopover({
  value,
  onChange,
  onKeyDown,
  onClose,
  placeholder,
  inputRef,
  matchLabel,
  onNext,
  onPrevious,
  canNavigate = true,
  options = [],
  leadingControl,
  extraActions,
  secondaryRow,
  className,
}: SearchPopoverProps) {
  return (
    <div className={cn(searchSurfaceVariants(), className)}>
      <div className="flex items-center gap-1.5">
        {leadingControl}

        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-text-lighter"
          />
          <Input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="h-8 rounded-lg border-border/80 bg-primary-bg py-1 pr-8 pl-8 text-xs"
          />
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="-translate-y-1/2 absolute top-1/2 right-1 flex size-6 items-center justify-center rounded-md text-text-lighter transition-colors hover:bg-hover hover:text-text"
              aria-label="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </div>

        {matchLabel && (
          <span className="ui-font shrink-0 text-text-lighter text-xs">{matchLabel}</span>
        )}

        {extraActions}

        <button
          type="button"
          onClick={onClose}
          className={searchIconButtonVariants()}
          aria-label="Close search"
        >
          <X size={12} />
        </button>
      </div>

      {(options.length > 0 || onPrevious || onNext) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={option.onToggle}
                className={searchToggleButtonVariants({ active: option.active })}
                title={option.label}
                aria-label={option.label}
                aria-pressed={option.active}
              >
                {option.icon}
              </button>
            ))}
          </div>

          {(onPrevious || onNext) && (
            <div className="flex items-center gap-1">
              {onPrevious && (
                <button
                  type="button"
                  onClick={onPrevious}
                  disabled={!canNavigate}
                  className={searchIconButtonVariants({ disabled: !canNavigate })}
                  aria-label="Previous match"
                >
                  <ChevronUp size={12} />
                </button>
              )}
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!canNavigate}
                  className={searchIconButtonVariants({ disabled: !canNavigate })}
                  aria-label="Next match"
                >
                  <ChevronDown size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {secondaryRow && <div className="mt-1.5">{secondaryRow}</div>}
    </div>
  );
}

export function SearchReplaceToggle({
  isExpanded,
  onToggle,
}: {
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={searchIconButtonVariants()}
      title={isExpanded ? "Hide replace" : "Show replace"}
      aria-label={isExpanded ? "Hide replace" : "Show replace"}
    >
      <ChevronRight size={12} className={cn("transition-transform", isExpanded && "rotate-90")} />
    </button>
  );
}

export function SearchReplaceRow({
  value,
  onChange,
  onKeyDown,
  inputRef,
  onReplace,
  onReplaceAll,
  canReplace,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  onReplace: () => void;
  onReplaceAll: () => void;
  canReplace: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 border-border/60 border-t pt-1.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-primary-bg text-text-lighter">
        <Replace size={12} />
      </span>

      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Replace with..."
        className="h-8 flex-1 rounded-lg border-border/80 bg-primary-bg py-1 text-xs"
      />

      <button
        type="button"
        onClick={onReplace}
        disabled={!canReplace}
        className={searchActionButtonVariants({ disabled: !canReplace })}
      >
        Replace
      </button>
      <button
        type="button"
        onClick={onReplaceAll}
        disabled={!canReplace}
        className={searchActionButtonVariants({ disabled: !canReplace })}
      >
        All
      </button>
    </div>
  );
}

export const SEARCH_TOGGLE_ICONS = {
  caseSensitive: <CaseSensitive size={12} />,
  wholeWord: <WholeWord size={12} />,
  regex: <Regex size={12} />,
};
