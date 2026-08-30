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
} from "@/ui/icons";
import { Button } from "@/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { Toggle } from "@/ui/toggle";
import { EmojiPicker } from "./emoji-picker";
import Tooltip from "@/ui/tooltip";

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
  if (!value) return <Hash className="size-3.5 text-subtle-foreground" weight="duotone" />;
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
      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as "emoji" | "icon")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="emoji">Emoji</TabsTrigger>
          <TabsTrigger value="icon">Icon</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-2">
        {activeTab === "emoji" ? (
          <EmojiPicker selected={selected} onSelect={onSelect} onClear={onClear} />
        ) : (
          <div className="grid grid-cols-6 gap-1">
            {CHANNEL_SYMBOL_OPTIONS.map((option) => {
              const Icon = option.icon;
              const value = `icon:${option.id}`;
              return (
                <Tooltip key={option.id} content={option.label}>
                  <Toggle
                    type="button"
                    pressed={selected === value}
                    onPressedChange={(pressed) => pressed && onSelect(value)}
                    aria-label={`Select ${option.label} icon`}
                  >
                    <Icon className="size-4" weight="duotone" />
                  </Toggle>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>

      {activeTab === "icon" ? (
        <Button type="button" variant="ghost" className="mt-2 w-full" onClick={onClear}>
          Reset to default
        </Button>
      ) : null}
    </div>
  );
}
