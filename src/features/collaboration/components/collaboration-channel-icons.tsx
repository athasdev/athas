import {
  ChatCircleTextIcon as ChatCircleText,
  CodeIcon as Code,
  HashIcon as Hash,
  LightningIcon as Lightning,
  LockKeyIcon as LockKey,
  MegaphoneIcon as Megaphone,
  PushPinIcon as PushPin,
  RocketLaunchIcon as RocketLaunch,
  WrenchIcon as Wrench,
} from "@phosphor-icons/react";
import { EmojiPicker } from "./emoji-picker";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

const CHANNEL_ICON_STORAGE_KEY = "athas.collaboration.channel-icons";

const CHANNEL_SYMBOL_OPTIONS = [
  { id: "hash", label: "Channel", icon: Hash },
  { id: "chat", label: "Chat", icon: ChatCircleText },
  { id: "wrench", label: "Tools", icon: Wrench },
  { id: "rocket", label: "Launch", icon: RocketLaunch },
  { id: "code", label: "Code", icon: Code },
  { id: "megaphone", label: "Announce", icon: Megaphone },
  { id: "lock", label: "Private", icon: LockKey },
  { id: "pin", label: "Pinned", icon: PushPin },
  { id: "lightning", label: "Fast", icon: Lightning },
];

export function loadChannelIcons() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CHANNEL_ICON_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveChannelIcons(icons: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHANNEL_ICON_STORAGE_KEY, JSON.stringify(icons));
}

export function renderChannelIcon(value: string | undefined) {
  if (!value) return <Hash className="size-3.5 text-text-lighter" weight="duotone" />;
  if (!value.startsWith("icon:")) return value;

  const symbol = CHANNEL_SYMBOL_OPTIONS.find((option) => option.id === value.slice(5));
  const Icon = symbol?.icon ?? Hash;
  return <Icon className="size-3.5" weight="duotone" />;
}

export function ChannelIconPicker({
  selected,
  activeTab,
  onTabChange,
  onSelect,
  onClear,
}: {
  selected: string | undefined;
  activeTab: "emoji" | "icon";
  onTabChange: (tab: "emoji" | "icon") => void;
  onSelect: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="w-60 p-1">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-primary-bg/70 p-1">
        {(["emoji", "icon"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "ui-text-xs h-7 rounded-md capitalize text-text-lighter hover:bg-hover hover:text-text",
              activeTab === tab && "bg-hover text-text",
            )}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-2">
        {activeTab === "emoji" ? (
          <EmojiPicker selected={selected} onSelect={onSelect} onClear={onClear} />
        ) : (
          <div className="grid grid-cols-6 gap-1">
            {CHANNEL_SYMBOL_OPTIONS.map((option) => {
              const Icon = option.icon;
              const value = `icon:${option.id}`;
              return (
                <Tooltip key={option.id} content={option.label} side="top">
                  <button
                    type="button"
                    className={cn(
                      "flex size-8 items-center justify-center rounded-md text-text-lighter hover:bg-hover hover:text-text",
                      selected === value && "bg-hover text-text",
                    )}
                    onClick={() => onSelect(value)}
                  >
                    <Icon className="size-4" weight="duotone" />
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>

      {activeTab === "icon" ? (
        <button
          type="button"
          className="ui-text-xs mt-2 h-7 w-full rounded-md text-center text-text-lighter hover:bg-hover hover:text-text"
          onClick={onClear}
        >
          Reset to default
        </button>
      ) : null}
    </div>
  );
}
