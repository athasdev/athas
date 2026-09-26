/**
 * ACP elicitations (`elicitation/create`, https://agentclientprotocol.com/protocol/v1/elicitation).
 * Form mode maps onto questionnaire steps, and the user's answers back onto the response content
 * the agent's schema asked for. URL mode asks the user to open a link, such as an MCP sign-in.
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
      /** Not enforced here: the spec asks clients not to run untrusted regexes unbounded. */
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
      items: { type?: string; enum?: string[]; anyOf?: EnumOption[] };
      _meta?: Meta;
    };

type ElicitationScope = { sessionId?: string; toolCallId?: string; requestId?: string };

/** A URL-mode request: the agent asks the user to open `url` and finish something there. */
export type AcpUrlElicitationRequest = ElicitationScope & {
  mode: "url";
  message: string;
  /** Matches the `elicitation/complete` notification sent when the flow finishes. */
  elicitationId: string;
  url: string;
  _meta?: Meta;
};

/** A form-mode request: the agent asks the questions in `requestedSchema`. */
export type AcpFormElicitationRequest = ElicitationScope & {
  mode: "form";
  message: string;
  requestedSchema: {
    type: "object";
    title?: string;
    description?: string;
    properties: Record<string, AcpElicitationProperty>;
    required?: string[];
  };
  _meta?: Meta;
};

/** The `elicitation/create` request as the agent sent it. */
export type AcpElicitationRequest = AcpFormElicitationRequest | AcpUrlElicitationRequest;

export type ElicitationContent = Record<string, string | number | boolean | string[]>;

/** URL mode accepts without content: it only means the user opened the link. */
export type AcpElicitationResponse =
  | { action: "accept"; content?: ElicitationContent }
  | { action: "decline" }
  | { action: "cancel" };

export type ElicitationOption = {
  value: string;
  label: string;
  description?: string;
  /** Claude's AskUserQuestion option preview (`_meta["_claude/askUserQuestionOption"].preview`). */
  preview?: string;
};

type QuestionBase = { name: string; title: string; description?: string; required: boolean };

export type ElicitationQuestion =
  | (QuestionBase & {
      kind: "choice";
      multiple: boolean;
      options: ElicitationOption[];
      defaults: string[];
      minItems?: number;
      maxItems?: number;
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

/**
 * codex-acp pairs a question with an optional `<id>_note` text field marked
 * `_meta.codex = { questionId, role: "user_note" }`, sent alongside the chosen option.
 */
function noteTarget(property: AcpElicitationProperty): string | undefined {
  const codex = metaRecord(property._meta?.codex);
  return codex?.role === "user_note" && typeof codex.questionId === "string"
    ? codex.questionId
    : undefined;
}

function optionPreview(option: EnumOption): string | undefined {
  const preview = metaRecord(option._meta?.["_claude/askUserQuestionOption"])?.preview;
  return typeof preview === "string" && preview.trim() ? preview : undefined;
}

function toOptions(values: string[] | undefined, titled: EnumOption[] | undefined) {
  if (titled?.length) {
    return titled.map((option) => ({
      value: option.const,
      label: option.title || option.const,
      description: option.description,
      preview: optionPreview(option),
    }));
  }
  return (values ?? []).map((value) => ({ value, label: value }));
}

/** A question for each field Athas can render; null for types it does not know. */
function toQuestion(
  name: string,
  property: AcpElicitationProperty,
  required: boolean,
): ElicitationQuestion | null {
  const base = { name, title: property.title || name, description: property.description, required };

  switch (property.type) {
    case "array": {
      // Multi-selects are titled `anyOf` items or string `enum` items. Other item types must not be
      // shown as a string multi-select.
      const { items } = property;
      const options = items.anyOf?.length
        ? toOptions(undefined, items.anyOf)
        : items.enum?.length && (items.type === undefined || items.type === "string")
          ? toOptions(items.enum, undefined)
          : null;
      if (!options) return null;
      return {
        ...base,
        kind: "choice",
        multiple: true,
        options,
        defaults: property.default ?? [],
        minItems: property.minItems,
        maxItems: property.maxItems,
      };
    }
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
    default:
      return null;
  }
}

/**
 * One questionnaire step per schema field, in schema order. Claude's paired custom-answer fields
 * fold into their choice question; a codex-acp note becomes an optional step after its question.
 * Fields of unknown types are left out; see `hasUnanswerableFields`.
 */
export function toElicitationQuestions(request: AcpFormElicitationRequest): ElicitationQuestion[] {
  const { properties, required = [] } = request.requestedSchema;
  const questions = new Map<string, ElicitationQuestion>();
  const customFields = new Map<string, string>();

  for (const [name, property] of Object.entries(properties)) {
    const target = customAnswerTarget(property);
    if (target && properties[target]) {
      customFields.set(target, name);
      continue;
    }
    const question = toQuestion(name, property, required.includes(name));
    if (!question) continue;
    const noteFor = noteTarget(property);
    const notedField = noteFor ? properties[noteFor] : undefined;
    questions.set(
      name,
      noteFor && notedField && question.kind === "text"
        ? { ...question, title: "Anything to add?", description: notedField.title || noteFor }
        : question,
    );
  }

  for (const [target, field] of customFields) {
    const question = questions.get(target);
    if (question?.kind === "choice") {
      questions.set(target, { ...question, otherField: field });
      continue;
    }
    // No choice question to attach to: ask for the custom answer on its own.
    const orphan = toQuestion(field, properties[field], required.includes(field));
    if (orphan) questions.set(field, orphan);
  }
  return [...questions.values()];
}

/** True when a required field has a type Athas cannot render, so the form cannot be accepted. */
export function hasUnanswerableFields(
  request: AcpFormElicitationRequest,
  questions: ElicitationQuestion[],
): boolean {
  const { properties, required = [] } = request.requestedSchema;
  const answerable = new Set(
    questions.flatMap((question) =>
      question.kind === "choice" && question.otherField
        ? [question.name, question.otherField]
        : [question.name],
    ),
  );
  return required.some((name) => name in properties && !answerable.has(name));
}

/** The first answer outside a multi-select's `minItems`/`maxItems`, as a message for the user. */
export function findElicitationError(
  questions: ElicitationQuestion[],
  content: ElicitationContent,
): string | null {
  for (const question of questions) {
    if (question.kind !== "choice" || !question.multiple) continue;
    const answer = content[question.name];
    const count = Array.isArray(answer) ? answer.length : 0;
    // An optional question left unanswered is fine; min/max apply once something is chosen.
    if (count === 0 && !question.required) continue;
    if (question.minItems !== undefined && count < question.minItems) {
      return `${question.title}: choose at least ${question.minItems}.`;
    }
    if (question.maxItems !== undefined && count > question.maxItems) {
      return `${question.title}: choose at most ${question.maxItems}.`;
    }
  }
  return null;
}

/**
 * Builds the `accept` content from the submitted form. Choice values that match an option go to the
 * question's field; typed text next to choices goes to its paired custom field. Unanswered optional
 * fields are left out.
 */
export function toElicitationContent(
  questions: ElicitationQuestion[],
  form: FormData,
): ElicitationContent {
  const content: ElicitationContent = {};

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

export type ElicitationLink =
  | {
      openable: true;
      href: string;
      host: string;
      /** Plain http: the page and anything typed into it travel unencrypted. */
      insecure: boolean;
      /** The host has punycode (`xn--`) labels, which can imitate a familiar domain. */
      punycode: boolean;
    }
  | { openable: false; reason: string };

/**
 * Checks a URL-mode link before the user is asked to open it. Only web links open; anything else
 * (file:, javascript:, custom schemes) is shown but refused.
 */
export function inspectElicitationUrl(url: string): ElicitationLink {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { openable: false, reason: "This link is not a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { openable: false, reason: `Athas only opens web links, not ${parsed.protocol} links.` };
  }
  if (!parsed.hostname) return { openable: false, reason: "This link has no host." };
  return {
    openable: true,
    href: parsed.href,
    host: parsed.host,
    insecure: parsed.protocol === "http:",
    punycode: parsed.hostname.split(".").some((label) => label.startsWith("xn--")),
  };
}
