/**
 * Maps ACP form elicitations (`elicitation/create`, https://agentclientprotocol.com/protocol/v1/elicitation)
 * onto questionnaire steps, and the user's answers back onto the response content the agent's schema
 * asked for. Athas advertises form mode only.
 */

type Meta = Record<string, unknown>;

type EnumOption = { const: string; title?: string; description?: string; _meta?: Meta };

export type AcpElicitationProperty =
  | {
      type: "string";
      title?: string;
      description?: string;
      default?: string;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      format?: "email" | "uri" | "date" | "date-time";
      enum?: string[];
      oneOf?: EnumOption[];
      _meta?: Meta;
    }
  | {
      type: "number" | "integer";
      title?: string;
      description?: string;
      default?: number;
      minimum?: number;
      maximum?: number;
      _meta?: Meta;
    }
  | { type: "boolean"; title?: string; description?: string; default?: boolean; _meta?: Meta }
  | {
      type: "array";
      title?: string;
      description?: string;
      default?: string[];
      minItems?: number;
      maxItems?: number;
      items: { type?: "string"; enum?: string[]; anyOf?: EnumOption[] };
      _meta?: Meta;
    };

/** The `elicitation/create` request as the agent sent it. */
export type AcpElicitationRequest = {
  mode: "form";
  message: string;
  sessionId?: string;
  toolCallId?: string;
  requestId?: string;
  requestedSchema: {
    type: "object";
    title?: string;
    description?: string;
    properties: Record<string, AcpElicitationProperty>;
    required?: string[];
  };
  _meta?: Meta;
};

export type AcpElicitationResponse =
  | { action: "accept"; content: Record<string, string | number | boolean | string[]> }
  | { action: "decline" }
  | { action: "cancel" };

export type ElicitationOption = { value: string; label: string; description?: string };

type QuestionBase = { name: string; title: string; description?: string; required: boolean };

export type ElicitationQuestion =
  | (QuestionBase & {
      kind: "choice";
      multiple: boolean;
      options: ElicitationOption[];
      defaults: string[];
      /** A free-text field the agent pairs with this question for answers outside the options. */
      otherField?: string;
    })
  | (QuestionBase & {
      kind: "text";
      inputType: "text" | "email" | "url" | "date" | "datetime-local" | "password";
      defaultValue?: string;
      minLength?: number;
      maxLength?: number;
    })
  | (QuestionBase & {
      kind: "number";
      integer: boolean;
      defaultValue?: number;
      minimum?: number;
      maximum?: number;
    });

const BOOLEAN_OPTIONS: ElicitationOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

const STRING_INPUT_TYPES = {
  email: "email",
  uri: "url",
  date: "date",
  "date-time": "datetime-local",
} as const;

function metaRecord(value: unknown): Meta | undefined {
  return value && typeof value === "object" ? (value as Meta) : undefined;
}

/**
 * Claude's adapter pairs each AskUserQuestion field with an optional `<name>_custom` text field
 * marked `_meta._askUserQuestionCustomAnswer = { questionId, isCustomAnswer: true }`.
 */
function customAnswerTarget(property: AcpElicitationProperty): string | undefined {
  const marker = metaRecord(property._meta?._askUserQuestionCustomAnswer);
  return marker?.isCustomAnswer === true && typeof marker.questionId === "string"
    ? marker.questionId
    : undefined;
}

function isSecret(property: AcpElicitationProperty): boolean {
  return metaRecord(property._meta?.codex)?.isSecret === true;
}

function toOptions(values: string[] | undefined, titled: EnumOption[] | undefined) {
  if (titled?.length) {
    return titled.map((option) => ({
      value: option.const,
      label: option.title || option.const,
      description: option.description,
    }));
  }
  return (values ?? []).map((value) => ({ value, label: value }));
}

function toQuestion(
  name: string,
  property: AcpElicitationProperty,
  required: boolean,
): ElicitationQuestion {
  const base = { name, title: property.title || name, description: property.description, required };

  switch (property.type) {
    case "array":
      return {
        ...base,
        kind: "choice",
        multiple: true,
        options: toOptions(property.items.enum, property.items.anyOf),
        defaults: property.default ?? [],
      };
    case "boolean":
      return {
        ...base,
        kind: "choice",
        multiple: false,
        options: BOOLEAN_OPTIONS,
        defaults: property.default === undefined ? [] : [String(property.default)],
      };
    case "number":
    case "integer":
      return {
        ...base,
        kind: "number",
        integer: property.type === "integer",
        defaultValue: property.default,
        minimum: property.minimum,
        maximum: property.maximum,
      };
    case "string": {
      const options = toOptions(property.enum, property.oneOf);
      if (options.length > 0) {
        return {
          ...base,
          kind: "choice",
          multiple: false,
          options,
          defaults: property.default ? [property.default] : [],
        };
      }
      return {
        ...base,
        kind: "text",
        inputType: isSecret(property)
          ? "password"
          : property.format
            ? STRING_INPUT_TYPES[property.format]
            : "text",
        defaultValue: property.default,
        minLength: property.minLength,
        maxLength: property.maxLength,
      };
    }
  }
}

/** One questionnaire step per schema field, in schema order. Paired custom-answer fields fold in. */
export function toElicitationQuestions(request: AcpElicitationRequest): ElicitationQuestion[] {
  const { properties, required = [] } = request.requestedSchema;
  const questions = new Map<string, ElicitationQuestion>();
  const customFields = new Map<string, string>();

  for (const [name, property] of Object.entries(properties)) {
    const target = customAnswerTarget(property);
    if (target && properties[target]) {
      customFields.set(target, name);
      continue;
    }
    questions.set(name, toQuestion(name, property, required.includes(name)));
  }

  for (const [target, field] of customFields) {
    const question = questions.get(target);
    if (question?.kind === "choice") questions.set(target, { ...question, otherField: field });
  }
  return [...questions.values()];
}

/**
 * Builds the `accept` content from the submitted form. Choice values that match an option go to the
 * question's field; typed text next to choices goes to its paired custom field. Unanswered optional
 * fields are left out.
 */
export function toElicitationContent(
  questions: ElicitationQuestion[],
  form: FormData,
): Extract<AcpElicitationResponse, { action: "accept" }>["content"] {
  const content: Extract<AcpElicitationResponse, { action: "accept" }>["content"] = {};

  for (const question of questions) {
    const values = form
      .getAll(question.name)
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);

    if (question.kind === "number") {
      const value = values[0];
      if (value !== undefined && Number.isFinite(Number(value)))
        content[question.name] = Number(value);
      continue;
    }

    if (question.kind === "text") {
      if (values[0] !== undefined) content[question.name] = values[0];
      continue;
    }

    const known = new Set(question.options.map((option) => option.value));
    const chosen = values.filter((value) => known.has(value));
    const typed = values.filter((value) => !known.has(value));

    if (question.options === BOOLEAN_OPTIONS) {
      if (chosen[0]) content[question.name] = chosen[0] === "true";
    } else if (question.multiple) {
      if (chosen.length > 0) content[question.name] = chosen;
    } else if (chosen[0] !== undefined) {
      content[question.name] = chosen[0];
    }

    if (question.otherField && typed[0] !== undefined) content[question.otherField] = typed[0];
  }
  return content;
}
