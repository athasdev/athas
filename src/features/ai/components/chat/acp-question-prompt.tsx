import { type SubmitEvent, useMemo, useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { QuestionIcon } from "@/ui/icons";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/ui/questionnaire";
import { cn } from "@/utils/cn";
import {
  type AcpElicitationResponse,
  type AcpFormElicitationRequest,
  type ElicitationQuestion,
  findElicitationError,
  hasUnanswerableFields,
  toElicitationContent,
  toElicitationQuestions,
} from "../../lib/acp-elicitation";
import { chatContentWidth } from "./chat-content-width";

function QuestionStep({ question }: { question: ElicitationQuestion }) {
  return (
    <QuestionnaireItem
      name={question.name}
      required={question.required}
      multiple={question.kind === "choice" && question.multiple}
    >
      <QuestionnaireTitle>{question.title}</QuestionnaireTitle>
      {question.description ? (
        <QuestionnaireDescription>{question.description}</QuestionnaireDescription>
      ) : null}

      {question.kind === "choice" ? (
        <>
          <QuestionnaireChoices>
            {question.options.map((option) => (
              <QuestionnaireChoice
                key={option.value}
                value={option.value}
                defaultChecked={question.defaults.includes(option.value)}
              >
                {option.label}
                {option.description ? (
                  <QuestionnaireChoiceDescription>
                    {option.description}
                  </QuestionnaireChoiceDescription>
                ) : null}
                {option.preview ? (
                  <span className="mt-1 block max-h-32 overflow-auto rounded-md border border-border bg-background px-2 py-1.5 font-mono whitespace-pre-wrap wrap-anywhere text-muted-foreground ui-text-caption">
                    {option.preview}
                  </span>
                ) : null}
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          {question.otherField ? (
            <QuestionnaireInput aria-label="Other answer" placeholder="Something else…" />
          ) : null}
        </>
      ) : question.kind === "number" ? (
        <QuestionnaireInput
          type="number"
          aria-label={question.title}
          defaultValue={question.defaultValue}
          min={question.minimum}
          max={question.maximum}
          step={question.integer ? 1 : "any"}
        />
      ) : (
        <QuestionnaireInput
          type={question.inputType}
          aria-label={question.title}
          defaultValue={question.defaultValue}
          minLength={question.minLength}
          maxLength={question.maxLength}
        />
      )}
      <QuestionnaireError />
    </QuestionnaireItem>
  );
}

/**
 * An agent's `elicitation/create` question, answered in the chat. Names the agent asking, steps
 * through the fields one at a time, and offers decline (continue without answering) and cancel
 * (abandon the request) as the ACP spec asks clients to.
 */
export function AcpQuestionPrompt({
  requestId,
  request,
  agentLabel,
  queuedCount,
  onAnswer,
}: {
  requestId: string;
  request: AcpFormElicitationRequest;
  agentLabel: string;
  queuedCount: number;
  onAnswer: (response: AcpElicitationResponse) => void;
}) {
  const questions = useMemo(() => toElicitationQuestions(request), [request]);
  const unanswerable = useMemo(
    () => hasUnanswerableFields(request, questions),
    [request, questions],
  );
  const [error, setError] = useState<string | null>(null);
  const { title: formTitle, description: formDescription } = request.requestedSchema;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = toElicitationContent(questions, new FormData(event.currentTarget));
    const problem = findElicitationError(questions, content);
    setError(problem);
    if (!problem) onAnswer({ action: "accept", content });
  };

  return (
    <div
      className={cn(
        chatContentWidth(),
        "mb-1 flex flex-col gap-2.5 rounded-xl border border-border bg-background p-2.5 shadow-(--shadow-card) ui-text-sm",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <QuestionIcon className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-subtle-foreground ui-text-caption">{agentLabel} is asking</span>
          <p className="text-pretty text-foreground">{request.message}</p>
        </div>
        {queuedCount > 0 ? <Badge>+{queuedCount}</Badge> : null}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onAnswer({ action: "decline" })}
            tooltip="Don't answer; the agent continues without it"
          >
            Decline
          </Button>
          <Button
            type="button"
            variant="ghost"
            tone="danger"
            size="sm"
            onClick={() => onAnswer({ action: "cancel" })}
            tooltip="Cancel what the agent was doing"
          >
            Cancel
          </Button>
        </div>
      </div>

      {formTitle || formDescription ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          {formTitle ? <span className="font-medium text-foreground">{formTitle}</span> : null}
          {formDescription ? (
            <p className="text-pretty text-muted-foreground">{formDescription}</p>
          ) : null}
        </div>
      ) : null}

      {unanswerable ? (
        <p className="text-pretty text-muted-foreground">
          This asks for something Athas can't show yet. Decline to let the agent continue without
          it.
        </p>
      ) : questions.length > 0 ? (
        <Questionnaire key={requestId} onSubmit={submit} shortcuts="numbers">
          {questions.length > 1 ? <QuestionnaireProgress /> : null}
          {questions.map((item) => (
            <QuestionStep key={item.name} question={item} />
          ))}
          {error ? <p className="text-pretty text-destructive">{error}</p> : null}
          <QuestionnaireActions>
            <QuestionnairePrevious />
            <QuestionnaireSkip />
            <QuestionnaireNext />
            <QuestionnaireSubmit>Send answer</QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      ) : (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="accent"
            onClick={() => onAnswer({ action: "accept", content: {} })}
          >
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}
