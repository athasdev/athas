import { Questionnaire as QuestionnairePrimitive } from "@shadcn/react/questionnaire";
import type { ComponentProps } from "react";
import { type ButtonSize, type ButtonVariant, buttonVariants } from "@/ui/button";
import { CheckIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";

/**
 * Multi-step question flow, from shadcn's Questionnaire on the @shadcn/react primitive. Each
 * QuestionnaireItem is one step; choices render as radios, or checkboxes with `multiple`, and a
 * QuestionnaireInput takes a typed answer, alone or next to choices. Answers submit as FormData
 * keyed by item name.
 */
function Questionnaire({
  className,
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Root>) {
  return (
    <QuestionnairePrimitive.Root
      data-slot="questionnaire"
      className={cn("flex w-full min-w-0 flex-col gap-3", className)}
      {...props}
    />
  );
}

function QuestionnaireProgress({
  className,
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Progress>) {
  return (
    <QuestionnairePrimitive.Progress
      data-slot="questionnaire-progress"
      className={cn("w-fit text-subtle-foreground tabular-nums ui-text-caption", className)}
      {...props}
    />
  );
}

function QuestionnaireItem({
  className,
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Item>) {
  return (
    <QuestionnairePrimitive.Item
      data-slot="questionnaire-item"
      className={cn("flex min-w-0 flex-col gap-2 border-0 p-0 outline-none", className)}
      {...props}
    />
  );
}

function QuestionnaireTitle({
  className,
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Title>) {
  return (
    <QuestionnairePrimitive.Title
      data-slot="questionnaire-title"
      className={cn("font-medium text-pretty text-foreground ui-text-sm", className)}
      {...props}
    />
  );
}

function QuestionnaireDescription({
  className,
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Description>) {
  return (
    <QuestionnairePrimitive.Description
      data-slot="questionnaire-description"
      className={cn("text-pretty text-muted-foreground ui-text-sm", className)}
      {...props}
    />
  );
}

function QuestionnaireChoices({
  className,
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Choices>) {
  return (
    <QuestionnairePrimitive.Choices
      data-slot="questionnaire-choices"
      className={cn("grid min-w-0 gap-1.5", className)}
      {...props}
    />
  );
}

function QuestionnaireChoice({
  children,
  className,
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Choice>) {
  return (
    <QuestionnairePrimitive.Choice
      data-slot="questionnaire-choice"
      className={cn(
        "group/questionnaire-choice relative flex cursor-pointer items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-start text-foreground ui-text-sm outline-none transition-colors duration-fast ease-smooth select-none hover:border-border-strong has-[>input:focus-visible]:ring-2 has-[>input:focus-visible]:ring-focus data-invalid:border-destructive data-checked:border-primary data-checked:bg-selected",
        "data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <QuestionnairePrimitive.ChoiceInput
        data-slot="questionnaire-choice-input"
        className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        data-slot="questionnaire-choice-indicator"
        className="pointer-events-none relative mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-background group-data-checked/questionnaire-choice:border-primary group-data-checked/questionnaire-choice:bg-primary group-data-checked/questionnaire-choice:text-primary-foreground group-data-[type=radio]/questionnaire-choice:rounded-full"
      >
        <span
          data-slot="questionnaire-choice-indicator-dot"
          className="hidden size-1.5 rounded-full bg-primary-foreground group-data-checked/questionnaire-choice:block group-data-[type=checkbox]/questionnaire-choice:hidden"
        />
        <CheckIcon
          data-slot="questionnaire-choice-indicator-check"
          className="hidden size-3 group-data-checked/questionnaire-choice:block group-data-[type=radio]/questionnaire-choice:hidden"
          optical="lg"
        />
      </span>
      <QuestionnairePrimitive.ChoiceLabel
        data-slot="questionnaire-choice-label"
        className="flex min-w-0 flex-1 flex-col gap-0.5 leading-row"
      >
        {children}
      </QuestionnairePrimitive.ChoiceLabel>
      <QuestionnairePrimitive.ChoiceShortcut
        data-slot="questionnaire-choice-shortcut"
        className="pointer-events-none ms-auto hidden size-4 shrink-0 items-center justify-center rounded-sm border border-border bg-background font-mono text-subtle-foreground ui-text-caption group-data-shortcut/questionnaire-choice:inline-flex"
      />
    </QuestionnairePrimitive.Choice>
  );
}

function QuestionnaireChoiceDescription({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="questionnaire-choice-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

function QuestionnaireInput({
  className,
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Input>) {
  return (
    <QuestionnairePrimitive.Input
      data-slot="questionnaire-input"
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-foreground ui-text-sm outline-none transition-[border-color,box-shadow] duration-fast ease-smooth placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

function QuestionnaireError({
  className,
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Error>) {
  return (
    <QuestionnairePrimitive.Error
      data-slot="questionnaire-error"
      className={cn("text-destructive ui-text-sm", className)}
      {...props}
    />
  );
}

function QuestionnaireActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="questionnaire-actions"
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5",
        className,
      )}
      {...props}
    />
  );
}

type NavigationStyle = { size?: ButtonSize; variant?: ButtonVariant };

function QuestionnairePrevious({
  children,
  className,
  size = "md",
  variant = "ghost",
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Previous> & NavigationStyle) {
  return (
    <QuestionnairePrimitive.Previous
      data-slot="questionnaire-previous"
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-1 row-start-1 justify-self-start",
        className,
      )}
      {...props}
    >
      {children ?? "Previous"}
    </QuestionnairePrimitive.Previous>
  );
}

function QuestionnaireSkip({
  children,
  className,
  size = "md",
  variant = "ghost",
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Skip> & NavigationStyle) {
  return (
    <QuestionnairePrimitive.Skip
      data-slot="questionnaire-skip"
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-2 row-start-1 justify-self-end",
        className,
      )}
      {...props}
    >
      {children ?? "Skip"}
    </QuestionnairePrimitive.Skip>
  );
}

function QuestionnaireNext({
  children,
  className,
  size = "md",
  variant = "accent",
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Next> & NavigationStyle) {
  return (
    <QuestionnairePrimitive.Next
      data-slot="questionnaire-next"
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-3 row-start-1 justify-self-end",
        className,
      )}
      {...props}
    >
      {children ?? "Next"}
    </QuestionnairePrimitive.Next>
  );
}

function QuestionnaireSubmit({
  children,
  className,
  size = "md",
  variant = "accent",
  ...props
}: ComponentProps<typeof QuestionnairePrimitive.Submit> & NavigationStyle) {
  return (
    <QuestionnairePrimitive.Submit
      data-slot="questionnaire-submit"
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-3 row-start-1 justify-self-end",
        className,
      )}
      {...props}
    >
      {children ?? "Submit"}
    </QuestionnairePrimitive.Submit>
  );
}

export {
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
};
