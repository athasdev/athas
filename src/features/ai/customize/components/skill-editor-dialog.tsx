import { useState } from "react";
import type { SkillDraft } from "@/features/ai/services/skill-library";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import { MagicWandIcon } from "@/ui/icons";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";

export function SkillEditorDialog({
  initialDraft,
  isCatalogSkill,
  onClose,
  onSave,
}: {
  initialDraft: SkillDraft;
  isCatalogSkill: boolean;
  onClose: () => void;
  onSave: (draft: SkillDraft) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialDraft.title);
  const [content, setContent] = useState(initialDraft.content);
  const [isSaving, setIsSaving] = useState(false);
  const canSave = title.trim().length > 0 && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await onSave({ id: initialDraft.id, title, content });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      title={initialDraft.id ? "Edit skill" : "New skill"}
      icon={MagicWandIcon}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {initialDraft.id ? "Save changes" : "Add skill"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="customize-skill-title">Title</FieldLabel>
          <Input
            id="customize-skill-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Code review checklist"
            maxLength={120}
            autoFocus
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="customize-skill-content">Instructions</FieldLabel>
          <Textarea
            id="customize-skill-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Write the instructions or reusable context for this skill..."
            rows={10}
          />
          <FieldDescription>
            {isCatalogSkill
              ? "Your changes are kept as a local override when the catalog version updates."
              : "Markdown. Pick the skill from the composer to hand it to an agent."}
          </FieldDescription>
        </Field>
      </div>
    </Dialog>
  );
}
