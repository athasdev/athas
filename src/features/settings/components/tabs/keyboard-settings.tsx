import Button from "@/ui/button";
import KeybindingBadge from "@/ui/keybinding-badge";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";

const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");

export const KeyboardSettings = () => {
  return (
    <div className="space-y-4">
      <Section title="File Operations">
        <SettingRow label="Quick File Open" description="Open file picker">
          <KeybindingBadge keys={isMac ? ["⌘", "P"] : ["Ctrl", "P"]} />
        </SettingRow>

        <SettingRow label="Save File" description="Save current file">
          <KeybindingBadge keys={isMac ? ["⌘", "S"] : ["Ctrl", "S"]} />
        </SettingRow>

        <SettingRow label="New File" description="Create new file">
          <KeybindingBadge keys={isMac ? ["⌘", "N"] : ["Ctrl", "N"]} />
        </SettingRow>

        <SettingRow label="Close Tab" description="Close current tab">
          <KeybindingBadge keys={isMac ? ["⌘", "W"] : ["Ctrl", "W"]} />
        </SettingRow>
      </Section>

      <Section title="Navigation">
        <SettingRow label="Command Palette" description="Open command palette">
          <KeybindingBadge keys={isMac ? ["⌘", "Shift", "P"] : ["Ctrl", "Shift", "P"]} />
        </SettingRow>

        <SettingRow label="Toggle Sidebar" description="Show/hide sidebar">
          <KeybindingBadge keys={isMac ? ["⌘", "B"] : ["Ctrl", "B"]} />
        </SettingRow>

        <SettingRow label="Go to Line" description="Jump to specific line">
          <KeybindingBadge keys={isMac ? ["⌘", "G"] : ["Ctrl", "G"]} />
        </SettingRow>

        <SettingRow label="Next Tab" description="Switch to next tab">
          <KeybindingBadge keys={isMac ? ["⌘", "Opt", "→"] : ["Ctrl", "Tab"]} />
        </SettingRow>
      </Section>

      <Section title="Editor">
        <SettingRow label="Find" description="Search in current file">
          <KeybindingBadge keys={isMac ? ["⌘", "F"] : ["Ctrl", "F"]} />
        </SettingRow>

        <SettingRow label="Find & Replace" description="Find and replace text">
          <KeybindingBadge keys={isMac ? ["⌘", "Opt", "F"] : ["Ctrl", "H"]} />
        </SettingRow>

        <SettingRow label="Comment Line" description="Toggle line comment">
          <KeybindingBadge keys={isMac ? ["⌘", "/"] : ["Ctrl", "/"]} />
        </SettingRow>

        <SettingRow label="Duplicate Line" description="Duplicate current line">
          <KeybindingBadge keys={isMac ? ["⌘", "Shift", "D"] : ["Ctrl", "Shift", "D"]} />
        </SettingRow>
      </Section>

      <Section title="Terminal">
        <SettingRow label="Toggle Terminal" description="Show/hide integrated terminal">
          <KeybindingBadge keys={isMac ? ["⌘", "`"] : ["Ctrl", "`"]} />
        </SettingRow>

        <SettingRow label="New Terminal" description="Create new terminal instance">
          <KeybindingBadge keys={isMac ? ["⌘", "Shift", "`"] : ["Ctrl", "Shift", "`"]} />
        </SettingRow>
      </Section>

      <Section title="Preferences">
        <SettingRow label="Tab Navigation" description="Navigate UI elements with Tab key">
          <Switch checked={true} onChange={() => {}} size="sm" />
        </SettingRow>

        <SettingRow label="Custom Shortcuts" description="Create custom keyboard shortcuts">
          <Button variant="ghost" size="xs">
            Manage
          </Button>
        </SettingRow>
      </Section>
    </div>
  );
};
