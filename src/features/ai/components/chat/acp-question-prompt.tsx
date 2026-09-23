import { type SubmitEvent, useMemo } from "react";
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
import type { AcpQuestion } from "../../hooks/use-acp-questions";
import {
  type AcpElicitationResponse,
  type ElicitationQuestion,
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
  question,
  agentLabel,
  queuedCount,
  onAnswer,
}: {
  question: AcpQuestion;
  agentLabel: string;
  queuedCount: number;
  onAnswer: (response: AcpElicitationResponse) => void;
}) {
  const questions = useMemo(() => toElicitationQuestions(question.request), [question.request]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAnswer({
      action: "accept",
      content: toElicitationContent(questions, new FormData(event.currentTarget)),
    });
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
          <p className="text-pretty text-foreground">{question.request.message}</p>
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

      {questions.length > 0 ? (
        <Questionnaire key={question.requestId} onSubmit={submit} shortcuts="numbers">
          {questions.length > 1 ? <QuestionnaireProgress /> : null}
          {questions.map((item) => (
            <QuestionStep key={item.name} question={item} />
          ))}
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
