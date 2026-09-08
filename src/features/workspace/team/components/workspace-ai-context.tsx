import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/ui/item";
import Textarea from "@/ui/textarea";
import type { WorkspaceSectionProps } from "./workspace-section-props";

export function WorkspaceAIContext({ config, onChange }: WorkspaceSectionProps) {
  return (
    <div className="space-y-6">
      <Field>
        <FieldLabel htmlFor="workspace-ai-instructions">Team instructions</FieldLabel>
        <Textarea
          id="workspace-ai-instructions"
          rows={14}
          maxLength={20000}
          value={config.instructions}
          onChange={(event) => onChange({ ...config, instructions: event.target.value })}
          placeholder="Describe your architecture, coding conventions and validation requirements."
        />
        <FieldDescription>
          After saving, these instructions accompany new messages to integrated agents and chat
          providers for this project. They provide context, not enforced security policies.
        </FieldDescription>
      </Field>
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>Project instruction files</ItemTitle>
          <ItemDescription>
            Keep detailed repository guidance in AGENTS.md or your agent's supported instruction
            files. Terminal agents continue to use their own project files.
          </ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>Agents and providers</ItemTitle>
          <ItemDescription>
            Manage available agents, models and credentials in your personal Agent settings.
            Credentials stay out of the shared workspace file.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button onClick={() => useUIState.getState().openSettingsDialog("ai")}>
            Configure agents
          </Button>
        </ItemActions>
      </Item>
    </div>
  );
}
