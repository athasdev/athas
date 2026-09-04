import { MagnifyingGlassIcon as Search } from "@/ui/icons";
import { useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription } from "@/ui/empty";
import Input from "@/ui/input";
import { Toggle } from "@/ui/toggle";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { defaultEmojiPickerOptions, emojiLabels } from "@/utils/emoji-catalog";

const RECENT_EMOJI_STORAGE_KEY = "athas.ui.emoji-picker.recent";
const MAX_RECENT_EMOJIS = 8;

interface EmojiPickerProps {
  selected?: string;
  options?: string[];
  columns?: number;
  onSelect: (emoji: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  className?: string;
}

function getEmojiLabel(emoji: string) {
  return emojiLabels[emoji]?.label ?? emoji;
}

function getRecentEmojis(options: string[]) {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_EMOJI_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is string => typeof value === "string" && options.includes(value),
    );
  } catch {
    return [];
  }
}

function rememberEmoji(emoji: string, options: string[]) {
  if (typeof window === "undefined") return;

  const recent = getRecentEmojis(options);
  const next = [emoji, ...recent.filter((value) => value !== emoji)].slice(0, MAX_RECENT_EMOJIS);
  window.localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, JSON.stringify(next));
}

export function EmojiPicker({
  selected,
  options = defaultEmojiPickerOptions,
  columns = 6,
  onSelect,
  onClear,
  clearLabel = "Reset to default",
  className,
}: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const [recentEmojis, setRecentEmojis] = useState(() => getRecentEmojis(options));

  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;

    return options.filter((emoji) => {
      const metadata = emojiLabels[emoji];
      const haystack = [emoji, metadata?.label, ...(metadata?.keywords ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, options]);

  const visibleRecentEmojis = useMemo(() => {
    if (normalizedQuery) return [];
    return recentEmojis.filter((emoji) => options.includes(emoji));
  }, [normalizedQuery, options, recentEmojis]);

  const primaryOptions = useMemo(
    () => filteredOptions.filter((emoji) => !visibleRecentEmojis.includes(emoji)),
    [filteredOptions, visibleRecentEmojis],
  );

  const handleSelect = (emoji: string) => {
    rememberEmoji(emoji, options);
    setRecentEmojis(getRecentEmojis(options));
    onSelect(emoji);
  };

  const renderEmojiButton = (emoji: string) => (
    <Tooltip key={emoji} content={getEmojiLabel(emoji)}>
      <Toggle
        type="button"
        pressed={selected === emoji}
        onPressedChange={(pressed) => pressed && handleSelect(emoji)}
        aria-label={`Select ${getEmojiLabel(emoji)}`}
      >
        {emoji}
      </Toggle>
    </Tooltip>
  );

  return (
    <div className={cn("w-full", className)}>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search emoji..."
        aria-label="Search emoji"
        leftIcon={Search}
      />

      {visibleRecentEmojis.length > 0 ? (
        <div className="mt-2">
          <div className="mb-1 px-1 ui-text-sm text-subtle-foreground uppercase">Recent</div>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {visibleRecentEmojis.map(renderEmojiButton)}
          </div>
        </div>
      ) : null}

      <div
        className="mt-2 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {primaryOptions.map(renderEmojiButton)}
      </div>

      {filteredOptions.length === 0 ? (
        <Empty className="mt-2">
          <EmptyDescription>No matching emoji</EmptyDescription>
        </Empty>
      ) : null}

      {onClear ? (
        <Button type="button" variant="ghost" className="mt-2 w-full" onClick={onClear}>
          {clearLabel}
        </Button>
      ) : null}
    </div>
  );
}
