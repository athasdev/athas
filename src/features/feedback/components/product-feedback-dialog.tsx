import { useEffect, useState, type FormEvent } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { platform, version as osVersion } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  aggregateFrictionSignals,
  buildFeedbackIssueUrl,
  type FeedbackDraft,
  type FeedbackEnvironment,
} from "@/features/feedback/lib/feedback-draft";
import { OPEN_PRODUCT_FEEDBACK_EVENT } from "@/features/feedback/services/product-feedback";
import {
  getTelemetryLogEntries,
  recordFrictionSignal,
} from "@/features/telemetry/services/telemetry";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/ui/field";
import { ChatCircleTextIcon } from "@/ui/icons";
import Switch from "@/ui/switch";
import Textarea from "@/ui/textarea";

const emptyDraft: FeedbackDraft = { intent: "", actual: "", expected: "" };

async function getFeedbackEnvironment(): Promise<FeedbackEnvironment> {
  const [appVersionResult, entriesResult] = await Promise.allSettled([
    getVersion(),
    getTelemetryLogEntries(),
  ]);
  let os: string;
  try {
    os = `${platform()} ${osVersion()}`;
  } catch {
    os = navigator.userAgent;
  }

  return {
    appVersion: appVersionResult.status === "fulfilled" ? appVersionResult.value : "unknown",
    os,
    frictionSignals: aggregateFrictionSignals(
      entriesResult.status === "fulfilled" ? entriesResult.value : [],
    ),
  };
}

export function ProductFeedbackDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<FeedbackDraft>(emptyDraft);
  const [includeEnvironment, setIncludeEnvironment] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      void recordFrictionSignal({ area: "feedback", signal: "opened" });
    };
    window.addEventListener(OPEN_PRODUCT_FEEDBACK_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_PRODUCT_FEEDBACK_EVENT, handleOpen);
  }, []);

  const close = () => {
    setIsOpen(false);
    setDraft(emptyDraft);
    setIncludeEnvironment(true);
    setError("");
    setIsSubmitting(false);
  };

  const updateDraft = (field: keyof FeedbackDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const canSubmit = Object.values(draft).every((value) => value.trim().length > 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    setError("");
    try {
      const environment = includeEnvironment ? await getFeedbackEnvironment() : undefined;
      await openUrl(buildFeedbackIssueUrl(draft, environment));
      void recordFrictionSignal({ area: "feedback", signal: "submitted" });
      close();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Athas could not open the feedback draft.",
      );
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      title="Send Product Feedback"
      icon={ChatCircleTextIcon}
      onClose={close}
      size="lg"
      footer={
        <>
          <Button type="button" variant="default" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="product-feedback-form"
            variant="accent"
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? "Preparing..." : "Review on GitHub"}
          </Button>
        </>
      }
    >
      <form id="product-feedback-form" onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="feedback-intent">What were you trying to do?</FieldLabel>
            <Textarea
              id="feedback-intent"
              autoFocus
              rows={3}
              maxLength={1_200}
              value={draft.intent}
              onChange={(event) => updateDraft("intent", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="feedback-actual">What happened?</FieldLabel>
            <Textarea
              id="feedback-actual"
              rows={3}
              maxLength={1_200}
              value={draft.actual}
              onChange={(event) => updateDraft("actual", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="feedback-expected">What did you expect?</FieldLabel>
            <Textarea
              id="feedback-expected"
              rows={3}
              maxLength={1_200}
              value={draft.expected}
              onChange={(event) => updateDraft("expected", event.target.value)}
            />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="feedback-environment">Include sanitized environment</FieldLabel>
              <FieldDescription>
                Adds the Athas version, OS, and counts of content-free friction signals. It never
                includes prompts, paths, filenames, errors, or editor text.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="feedback-environment"
              checked={includeEnvironment}
              onChange={setIncludeEnvironment}
            />
          </Field>
          <FieldError>{error}</FieldError>
        </FieldGroup>
      </form>
    </Dialog>
  );
}
