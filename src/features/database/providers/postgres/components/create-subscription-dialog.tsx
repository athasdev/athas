import { Radio } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";
import type { CreatePostgresSubscriptionParams } from "../../sqlite/sqlite-types";

interface CreateSubscriptionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (params: CreatePostgresSubscriptionParams) => Promise<void>;
}

const initialForm: CreatePostgresSubscriptionParams = {
  name: "",
  connection_string: "",
  publications: [],
  enabled: true,
  create_slot: true,
  copy_data: true,
  connect: true,
  failover: false,
  with_slot_name: "",
};

export default function CreateSubscriptionDialog({
  isOpen,
  onClose,
  onSubmit,
}: CreateSubscriptionDialogProps) {
  const [form, setForm] = useState<CreatePostgresSubscriptionParams>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setForm(initialForm);
    setIsSubmitting(false);
    onClose();
  };

  const submitForm = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit({
        ...form,
        publications: form.publications,
        with_slot_name: form.with_slot_name?.trim() || null,
      });
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitForm();
  };

  return (
    <Dialog
      onClose={handleClose}
      title="Create Subscription"
      icon={Radio}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void submitForm()}
            disabled={
              isSubmitting ||
              !form.name.trim() ||
              !form.connection_string.trim() ||
              form.publications.length === 0
            }
          >
            Create
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <label className="text-sm">Name</label>
          <Input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="analytics_sub"
            disabled={isSubmitting}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm">Connection String</label>
          <Textarea
            value={form.connection_string}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                connection_string: e.target.value,
              }))
            }
            className="h-20 resize-none rounded-xl border-border/70 bg-secondary-bg/60"
            placeholder="host=127.0.0.1 port=5432 dbname=postgres user=replicator password=secret"
            disabled={isSubmitting}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm">Publications</label>
          <Input
            value={form.publications.join(", ")}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                publications: e.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="pub_one, pub_two"
            disabled={isSubmitting}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm">Slot Name</label>
          <Input
            value={form.with_slot_name ?? ""}
            onChange={(e) => setForm((prev) => ({ ...prev, with_slot_name: e.target.value }))}
            placeholder="Leave blank for default"
            disabled={isSubmitting}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.enabled}
              onChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
            />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.create_slot}
              onChange={(checked) => setForm((prev) => ({ ...prev, create_slot: checked }))}
            />
            Create Slot
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.copy_data}
              onChange={(checked) => setForm((prev) => ({ ...prev, copy_data: checked }))}
            />
            Copy Existing Data
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.connect}
              onChange={(checked) => setForm((prev) => ({ ...prev, connect: checked }))}
            />
            Connect Immediately
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.failover}
              onChange={(checked) => setForm((prev) => ({ ...prev, failover: checked }))}
            />
            Enable failover slot sync
          </label>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
