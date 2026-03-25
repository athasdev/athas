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
import { Button } from "@/ui/button";
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
  "flex size-6 items-center justify-center rounded-lg border border-transparent text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text",
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
  "flex size-6 items-center justify-center rounded-lg border border-transparent transition-colors hover:border-border/70 hover:bg-hover",
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
  "ui-font ui-text-sm flex h-8 items-center justify-center rounded-lg border border-transparent px-2.5 text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text",
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
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-text-lighter" />
          <Input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="ui-text-sm h-8 rounded-lg border-border/80 bg-primary-bg py-1 pr-8 pl-8"
          />
          {value && (
            <Button
              type="button"
              onClick={() => onChange("")}
              variant="ghost"
              size="icon-xs"
              className="-translate-y-1/2 absolute top-1/2 right-1"
              aria-label="Clear search"
            >
              <X />
            </Button>
          )}
        </div>

        {matchLabel && (
          <span className="ui-font ui-text-sm shrink-0 text-text-lighter">{matchLabel}</span>
        )}

        {extraActions}

        <Button
          type="button"
          onClick={onClose}
          variant="ghost"
          size="icon-xs"
          className={searchIconButtonVariants()}
          aria-label="Close search"
        >
          <X />
        </Button>
      </div>

      {(options.length > 0 || onPrevious || onNext) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {options.map((option) => (
              <Button
                key={option.id}
                type="button"
                onClick={option.onToggle}
                variant="ghost"
                size="icon-xs"
                className={searchToggleButtonVariants({
                  active: option.active,
                })}
                title={option.label}
                aria-label={option.label}
                aria-pressed={option.active}
              >
                {option.icon}
              </Button>
            ))}
          </div>

          {(onPrevious || onNext) && (
            <div className="flex items-center gap-1">
              {onPrevious && (
                <Button
                  type="button"
                  onClick={onPrevious}
                  disabled={!canNavigate}
                  variant="ghost"
                  size="icon-xs"
                  className={searchIconButtonVariants({
                    disabled: !canNavigate,
                  })}
                  aria-label="Previous match"
                >
                  <ChevronUp />
                </Button>
              )}
              {onNext && (
                <Button
                  type="button"
                  onClick={onNext}
                  disabled={!canNavigate}
                  variant="ghost"
                  size="icon-xs"
                  className={searchIconButtonVariants({
                    disabled: !canNavigate,
                  })}
                  aria-label="Next match"
                >
                  <ChevronDown />
                </Button>
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
    <Button
      type="button"
      onClick={onToggle}
      variant="ghost"
      size="icon-xs"
      className={searchIconButtonVariants()}
      title={isExpanded ? "Hide replace" : "Show replace"}
      aria-label={isExpanded ? "Hide replace" : "Show replace"}
    >
      <ChevronRight className={cn("transition-transform", isExpanded && "rotate-90")} />
    </Button>
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
        <Replace />
      </span>

      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Replace with..."
        className="ui-text-sm h-8 flex-1 rounded-lg border-border/80 bg-primary-bg py-1"
      />

      <Button
        type="button"
        onClick={onReplace}
        disabled={!canReplace}
        variant="ghost"
        size="sm"
        className={searchActionButtonVariants({ disabled: !canReplace })}
      >
        Replace
      </Button>
      <Button
        type="button"
        onClick={onReplaceAll}
        disabled={!canReplace}
        variant="ghost"
        size="sm"
        className={searchActionButtonVariants({ disabled: !canReplace })}
      >
        All
      </Button>
    </div>
  );
}

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  matchLabel?: string | null;
  options?: SearchToggleOption[];
  extraActions?: ReactNode;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  inputRef,
  matchLabel,
  options = [],
  extraActions,
  className,
}: SearchInputProps) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}>
      <div className="relative min-w-0 flex-1">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-text-lighter" />
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="ui-text-sm h-8 rounded-lg border-border/80 bg-primary-bg py-1 pr-8 pl-8"
        />
        {value && (
          <Button
            type="button"
            onClick={() => onChange("")}
            variant="ghost"
            size="icon-xs"
            className="-translate-y-1/2 absolute top-1/2 right-1"
            aria-label="Clear search"
          >
            <X />
          </Button>
        )}
      </div>

      {options.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          {options.map((option) => (
            <Button
              key={option.id}
              type="button"
              onClick={option.onToggle}
              variant="ghost"
              size="icon-xs"
              className={searchToggleButtonVariants({
                active: option.active,
              })}
              title={option.label}
              aria-label={option.label}
              aria-pressed={option.active}
            >
              {option.icon}
            </Button>
          ))}
        </div>
      )}

      {matchLabel && (
        <span className="ui-font ui-text-sm shrink-0 text-text-lighter">{matchLabel}</span>
      )}

      {extraActions}
    </div>
  );
}

export const SEARCH_TOGGLE_ICONS = {
  caseSensitive: <CaseSensitive />,
  wholeWord: <WholeWord />,
  regex: <Regex />,
};
