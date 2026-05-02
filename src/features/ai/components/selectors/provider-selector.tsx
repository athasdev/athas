import { Check } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { getAvailableProviders, getProviderById } from "@/features/ai/types/providers";
import { Button, buttonVariants } from "@/ui/button";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import { cn } from "@/utils/cn";
import { matchesSearchQuery } from "@/utils/search-match";
import {
  chatComposerControlClassName,
  chatComposerDropdownClassName,
} from "../input/chat-composer-control-styles";
import { getSelectorDropdownWidth } from "./selector-dropdown-width";

interface ProviderSelectorProps {
  providerId: string;
  onChange: (providerId: string) => void;
  appearance?: "settings" | "composer";
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tooltip?: string;
}

export function ProviderSelector({
  providerId,
  onChange,
  appearance = "settings",
  disabled,
  className,
  triggerClassName,
  open,
  onOpenChange,
  tooltip,
}: ProviderSelectorProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const providers = useMemo(() => getAvailableProviders(), []);
  const currentProvider = getProviderById(providerId);
  const isComposer = appearance === "composer";

  const setOpen = (nextOpen: boolean) => {
    if (disabled && nextOpen) return;
    if (open === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }
    requestAnimationFrame(() => triggerInputRef.current?.focus());
  }, [isOpen]);

  const filteredProviders = useMemo(() => {
    return providers.filter((provider) => matchesSearchQuery(query, [provider.name, provider.id]));
  }, [providers, query]);
  const currentProviderName = currentProvider?.name || providerId;
  const dropdownWidth = useMemo(
    () =>
      getSelectorDropdownWidth({
        labels: filteredProviders.map((provider) => provider.name),
        min: isComposer ? 112 : 128,
        max: isComposer ? 220 : 240,
        chrome: 62,
      }),
    [filteredProviders, isComposer],
  );
  const openTriggerWidth = useMemo(
    () =>
      getSelectorDropdownWidth({
        labels: [currentProviderName],
        min: isComposer ? 96 : 160,
        max: isComposer ? 128 : 220,
        chrome: isComposer ? 34 : 48,
      }),
    [currentProviderName, isComposer],
  );

  useEffect(() => {
    if (!isOpen) return;
    const currentIndex = filteredProviders.findIndex((provider) => provider.id === providerId);
    setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [filteredProviders, isOpen, providerId]);

  useEffect(() => {
    if (!isOpen) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const triggerClass = cn(
    isComposer
      ? chatComposerControlClassName("w-fit max-w-[128px]")
      : "ui-font w-[220px] max-w-full justify-start gap-2 rounded-lg border border-border/70 bg-secondary-bg px-2.5 text-xs",
    triggerClassName,
  );

  const handleTriggerInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (filteredProviders.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, filteredProviders.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(filteredProviders.length - 1);
        break;
      case "Enter": {
        event.preventDefault();
        const selectedProvider = filteredProviders[activeIndex] ?? filteredProviders[0];
        if (!selectedProvider) return;
        onChange(selectedProvider.id);
        setOpen(false);
        break;
      }
    }
  };

  return (
    <div className={className}>
      {isOpen ? (
        <div
          ref={(node) => {
            triggerRef.current = node;
          }}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          className={cn(
            buttonVariants({
              variant: isComposer ? "ghost" : "secondary",
              size: isComposer ? "xs" : "sm",
            }),
            triggerClass,
            "cursor-text",
          )}
          style={{ width: openTriggerWidth }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => triggerInputRef.current?.focus()}
        >
          <ProviderIcon
            providerId={providerId}
            size={isComposer ? 12 : 14}
            className="shrink-0 text-text-lighter"
          />
          <input
            ref={triggerInputRef}
            type="text"
            value={query}
            disabled={disabled}
            placeholder={currentProviderName}
            aria-label="Search AI providers"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleTriggerInputKeyDown}
            className="ui-font min-w-0 flex-1 bg-transparent p-0 text-left text-text outline-none placeholder:text-text disabled:pointer-events-none"
          />
        </div>
      ) : (
        <Button
          ref={(node) => {
            triggerRef.current = node;
          }}
          type="button"
          variant={isComposer ? "ghost" : "secondary"}
          size={isComposer ? "xs" : "sm"}
          disabled={disabled}
          tooltip={tooltip}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label="Select AI provider"
          onClick={() => setOpen(!isOpen)}
          className={triggerClass}
        >
          <ProviderIcon
            providerId={providerId}
            size={isComposer ? 12 : 14}
            className="shrink-0 text-text-lighter"
          />
          <span className="min-w-0 truncate text-text">{currentProviderName}</span>
        </Button>
      )}

      <Dropdown
        isOpen={isOpen}
        anchorRef={triggerRef}
        anchorSide="bottom"
        onClose={() => setOpen(false)}
        className={cn(
          isComposer
            ? chatComposerDropdownClassName("min-w-0 p-0")
            : "min-w-0 overflow-hidden rounded-xl p-0",
        )}
        portalContainer={triggerRef.current?.closest(".ai-chat-container")}
        style={{ maxHeight: "260px", minWidth: 0, width: dropdownWidth }}
      >
        <div
          ref={listRef}
          className="custom-scrollbar-thin max-h-64 overflow-y-auto overscroll-contain p-1"
          onWheel={(event) => event.stopPropagation()}
        >
          {filteredProviders.map((provider) => {
            const isCurrent = provider.id === providerId;
            const isActive = filteredProviders[activeIndex]?.id === provider.id;

            return (
              <button
                key={provider.id}
                ref={(node) => {
                  const index = filteredProviders.findIndex((item) => item.id === provider.id);
                  if (index >= 0) itemRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => {
                  onChange(provider.id);
                  setOpen(false);
                }}
                onMouseEnter={() => setActiveIndex(filteredProviders.indexOf(provider))}
                onPointerMove={() => setActiveIndex(filteredProviders.indexOf(provider))}
                className={cn(
                  dropdownItemClassName(),
                  "mb-1 min-h-8 gap-2 py-2 text-xs last:mb-0",
                  isActive && "bg-hover",
                  isCurrent && "bg-selected/90 ring-1 ring-accent/10",
                )}
              >
                <ProviderIcon
                  providerId={provider.id}
                  size={14}
                  className="shrink-0 text-text-lighter"
                />
                <span className="min-w-0 flex-1 truncate text-text">{provider.name}</span>
                {isCurrent && <Check className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      </Dropdown>
    </div>
  );
}
