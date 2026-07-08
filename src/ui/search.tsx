import {
  TextAaIcon as CaseSensitive,
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  CaretUpIcon as ChevronUp,
  BracketsCurlyIcon as Regex,
  ArrowsLeftRightIcon as Replace,
  MagnifyingGlassIcon as Search,
  TextTIcon as WholeWord,
  XIcon as X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { forwardRef, type ComponentProps, type ReactNode, type RefObject } from "react";
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
  matchTone?: "default" | "warning";
  onNext?: () => void;
  onPrevious?: () => void;
  canNavigate?: boolean;
  options?: SearchToggleOption[];
  leadingControl?: ReactNode;
  extraActions?: ReactNode;
  secondaryRow?: ReactNode;
  className?: string;
}

export const SearchField = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<typeof Input>, "onChange" | "value" | "leftIcon"> & {
    value: string;
    onChange: (value: string) => void;
    leftIcon?: PhosphorIcon;
  }
>(function SearchField(
  { value, onChange, leftIcon = Search, placeholder = "Search", ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      leftIcon={leftIcon}
      placeholder={placeholder}
      {...props}
    />
  );
});

const searchSurfaceClass =
  "w-[320px] rounded-[var(--app-radius-menu)] border border-border/70 bg-primary-bg/95 p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-sm";

const searchIconButtonClass = "size-6 min-h-6 min-w-6 px-0";

const searchActionButtonClass = "h-8 px-2.5";

export function SearchPopover({
  value,
  onChange,
  onKeyDown,
  onClose,
  placeholder,
  inputRef,
  matchLabel,
  matchTone = "default",
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
    <div className={cn(searchSurfaceClass, className)}>
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
            className="ui-text-sm h-8 rounded-[var(--app-radius-control)] border-border/80 bg-primary-bg py-1 pr-8 pl-8"
          />
          {value && (
            <Button
              type="button"
              onClick={() => onChange("")}
              variant="ghost"
              compact
              className="-translate-y-1/2 absolute top-1/2 right-1"
              aria-label="Clear search"
            >
              <X />
            </Button>
          )}
        </div>

        {matchLabel && (
          <span
            className={cn(
              "ui-font ui-text-sm shrink-0",
              matchTone === "warning" ? "text-warning" : "text-text-lighter",
            )}
          >
            {matchLabel}
          </span>
        )}

        {extraActions}

        <Button
          type="button"
          onClick={onClose}
          variant="ghost"
          className={searchIconButtonClass}
          aria-label="Close search"
          compact
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
                active={option.active}
                className={searchIconButtonClass}
                tooltip={option.label}
                aria-label={option.label}
                aria-pressed={option.active}
                compact
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
                  className={searchIconButtonClass}
                  aria-label="Previous match"
                  compact
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
                  className={searchIconButtonClass}
                  aria-label="Next match"
                  compact
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
  expandedLabel = "Hide replace",
  collapsedLabel = "Show replace",
}: {
  isExpanded: boolean;
  onToggle: () => void;
  expandedLabel?: string;
  collapsedLabel?: string;
}) {
  const label = isExpanded ? expandedLabel : collapsedLabel;

  return (
    <Button
      type="button"
      onClick={onToggle}
      variant="ghost"
      className={searchIconButtonClass}
      tooltip={label}
      aria-label={label}
      compact
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
  canReplaceAll = canReplace,
  replaceAllTooltip,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  onReplace: () => void;
  onReplaceAll: () => void;
  canReplace: boolean;
  canReplaceAll?: boolean;
  replaceAllTooltip?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 border-border/60 border-t pt-1.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--app-radius-control)] border border-border/70 bg-primary-bg text-text-lighter">
        <Replace />
      </span>

      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Replace with..."
        className="ui-text-sm h-8 flex-1 rounded-[var(--app-radius-control)] border-border/80 bg-primary-bg py-1"
      />

      <Button
        type="button"
        onClick={onReplace}
        disabled={!canReplace}
        variant="ghost"
        className={searchActionButtonClass}
        compact
      >
        Replace
      </Button>
      <Button
        type="button"
        onClick={onReplaceAll}
        disabled={!canReplaceAll}
        variant="ghost"
        className={searchActionButtonClass}
        tooltip={replaceAllTooltip}
        compact
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
          className="ui-text-sm h-8 rounded-[var(--app-radius-control)] border-border/80 bg-primary-bg py-1 pr-8 pl-8"
        />
        {value && (
          <Button
            type="button"
            onClick={() => onChange("")}
            variant="ghost"
            compact
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
              active={option.active}
              className={searchIconButtonClass}
              tooltip={option.label}
              aria-label={option.label}
              aria-pressed={option.active}
              compact
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
  preserveCase: <span className="ui-font ui-text-sm font-semibold">Aa</span>,
};
