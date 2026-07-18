import { MagnifyingGlassIcon as Search } from "@/ui/icons";
import { useMemo, useState } from "react";
import Input from "@/ui/input";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

const RECENT_EMOJI_STORAGE_KEY = "athas.ui.emoji-picker.recent";
const MAX_RECENT_EMOJIS = 8;

export const defaultEmojiPickerOptions = [
  "💬",
  "🛠️",
  "🚀",
  "🧪",
  "📣",
  "🔒",
  "📌",
  "⚡",
  "✅",
  "🔥",
  "🎯",
  "🧠",
  "👀",
  "🙌",
  "🙏",
  "❤️",
  "✨",
  "⭐",
  "💡",
  "📎",
  "📁",
  "📝",
  "🐛",
  "🚨",
  "⏳",
  "🔍",
  "🎨",
  "⚙️",
  "🧩",
  "🧵",
  "📦",
  "🧹",
];

const emojiLabels: Record<string, { label: string; keywords: string[] }> = {
  "💬": { label: "Message", keywords: ["chat", "comment", "thread"] },
  "🛠️": { label: "Tools", keywords: ["fix", "build", "work"] },
  "🚀": { label: "Launch", keywords: ["ship", "release", "deploy"] },
  "🧪": { label: "Test", keywords: ["lab", "qa", "experiment"] },
  "📣": { label: "Announcement", keywords: ["news", "broadcast"] },
  "🔒": { label: "Private", keywords: ["lock", "secure"] },
  "📌": { label: "Pinned", keywords: ["pin", "important"] },
  "⚡": { label: "Fast", keywords: ["bolt", "performance"] },
  "✅": { label: "Done", keywords: ["check", "complete"] },
  "🔥": { label: "Hot", keywords: ["fire", "urgent"] },
  "🎯": { label: "Goal", keywords: ["target", "focus"] },
  "🧠": { label: "Ideas", keywords: ["brain", "think"] },
  "👀": { label: "Review", keywords: ["eyes", "look"] },
  "🙌": { label: "Celebrate", keywords: ["hands", "thanks"] },
  "🙏": { label: "Request", keywords: ["please", "pray"] },
  "❤️": { label: "Love", keywords: ["heart", "like"] },
  "✨": { label: "Polish", keywords: ["sparkles", "clean"] },
  "⭐": { label: "Star", keywords: ["favorite", "important"] },
  "💡": { label: "Idea", keywords: ["light", "bulb"] },
  "📎": { label: "Attachment", keywords: ["clip", "file"] },
  "📁": { label: "Files", keywords: ["folder", "project"] },
  "📝": { label: "Notes", keywords: ["memo", "write"] },
  "🐛": { label: "Bug", keywords: ["issue", "debug"] },
  "🚨": { label: "Alert", keywords: ["warning", "incident"] },
  "⏳": { label: "Waiting", keywords: ["hourglass", "pending"] },
  "🔍": { label: "Search", keywords: ["find", "inspect"] },
  "🎨": { label: "Design", keywords: ["paint", "style"] },
  "⚙️": { label: "Settings", keywords: ["gear", "config"] },
  "🧩": { label: "Integration", keywords: ["plugin", "piece"] },
  "🧵": { label: "Thread", keywords: ["conversation", "topic"] },
  "📦": { label: "Package", keywords: ["box", "bundle"] },
  "🧹": { label: "Cleanup", keywords: ["sweep", "refactor"] },
};

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
    <Tooltip key={emoji} content={getEmojiLabel(emoji)} side="top">
      <button
        type="button"
        className={cn(
          "flex size-8 items-center justify-center rounded-md border border-transparent ui-text-base hover:bg-hover",
          "focus-visible:border-accent focus-visible:outline-none",
          selected === emoji && "border-accent/50 bg-hover",
        )}
        onClick={() => handleSelect(emoji)}
        aria-label={`Select ${getEmojiLabel(emoji)}`}
        aria-pressed={selected === emoji}
      >
        {emoji}
      </button>
    </Tooltip>
  );

  return (
    <div className={cn("w-full", className)}>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search emoji..."
        aria-label="Search emoji"
        size="xs"
        leftIcon={Search}
      />

      {visibleRecentEmojis.length > 0 ? (
        <div className="mt-2">
          <div className="mb-1 px-1 ui-text-sm text-text-lighter uppercase">Recent</div>
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
        <div className="mt-2 rounded-md border border-border/60 px-2 py-3 text-center ui-text-sm text-text-lighter">
          No matching emoji
        </div>
      ) : null}

      {onClear ? (
        <button
          type="button"
          className="mt-2 h-7 w-full rounded-md text-center ui-text-sm text-text-lighter hover:bg-hover hover:text-text"
          onClick={onClear}
        >
          {clearLabel}
        </button>
      ) : null}
    </div>
  );
}
