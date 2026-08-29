import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/accordion";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import Input from "@/ui/input";
import NumberInput from "@/ui/number-input";
import Select from "@/ui/select";
import { Spinner } from "@/ui/spinner";
import Switch from "@/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import Textarea from "@/ui/textarea";
import { ToggleGroup } from "@/ui/toggle-group";
import { DynamicIcon } from "./dynamic-icon";
import {
  collectExtensionViewFormFields,
  createExtensionViewFormValues,
  EXTENSION_VIEW_FORM_LIMITS,
  extensionViewFormPayloadFits,
  getMissingExtensionViewFormFields,
} from "../services/extension-view-form";
import type {
  ExtensionViewAction,
  ExtensionViewFormValue,
  ExtensionViewFormValues,
  ExtensionViewNode,
} from "../types/extension-view";

type InputNode = Extract<ExtensionViewNode, { type: "input" }>;
type TextareaNode = Extract<ExtensionViewNode, { type: "textarea" }>;
type NumberInputNode = Extract<ExtensionViewNode, { type: "numberInput" }>;
type SelectNode = Extract<ExtensionViewNode, { type: "select" }>;
type ToggleNode = Extract<ExtensionViewNode, { type: "toggle" }>;
type CheckboxNode = Extract<ExtensionViewNode, { type: "checkbox" }>;
type ChoiceNode = Extract<ExtensionViewNode, { type: "choice" }>;
type TabsNode = Extract<ExtensionViewNode, { type: "tabs" }>;
type DisclosureNode = Extract<ExtensionViewNode, { type: "disclosure" }>;
type ButtonNode = Extract<ExtensionViewNode, { type: "button" }>;
type FormNode = Extract<ExtensionViewNode, { type: "form" }>;
type ScreenAction = NonNullable<Extract<ExtensionViewNode, { type: "screen" }>["actions"]>[number];

export type ExtensionViewExecute = (
  action: ExtensionViewAction,
  extraArgs?: unknown[],
) => void | Promise<void>;

interface ExtensionControlProps<Node> {
  node: Node;
  execute: ExtensionViewExecute;
}

interface ExtensionFormContextValue {
  invalidFields: Set<string>;
  setValue: (name: string, value: ExtensionViewFormValue) => void;
}

const ExtensionFormContext = createContext<ExtensionFormContextValue | null>(null);

function useFormField(name: string | undefined) {
  const form = useContext(ExtensionFormContext);
  return {
    invalid: Boolean(name && form?.invalidFields.has(name)),
    update: (value: ExtensionViewFormValue) => {
      if (name) form?.setValue(name, value);
    },
  };
}

function FieldLabelText({ label, required }: { label: string; required?: boolean }) {
  return (
    <>
      {label}
      {required ? <span aria-hidden="true"> *</span> : null}
    </>
  );
}

function RequiredFieldError({ invalid }: { invalid: boolean }) {
  return invalid ? (
    <span role="alert" className="text-destructive ui-text-sm">
      This field is required.
    </span>
  ) : null;
}

function usePendingAction(execute: ExtensionViewExecute) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const run = async (action: ExtensionViewAction, extraArgs?: unknown[]) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await execute(action, extraArgs);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return { pending, run };
}

export function ExtensionFormControl({
  node,
  execute,
  renderChildren,
}: ExtensionControlProps<FormNode> & {
  renderChildren: (children: ExtensionViewNode[]) => ReactNode;
}) {
  const fields = useMemo(() => collectExtensionViewFormFields(node.children), [node.children]);
  const initialValues = useMemo(() => createExtensionViewFormValues(fields), [fields]);
  const [values, setValues] = useState<ExtensionViewFormValues>(initialValues);
  const [attempted, setAttempted] = useState(false);
  const [payloadTooLarge, setPayloadTooLarge] = useState(false);
  const { pending, run } = usePendingAction(execute);

  useEffect(() => {
    setValues(initialValues);
    setAttempted(false);
    setPayloadTooLarge(false);
  }, [initialValues]);

  const missingFields = getMissingExtensionViewFormFields(fields, values);
  const invalidFields = useMemo(
    () => new Set(attempted ? missingFields : []),
    [attempted, missingFields],
  );
  const context = useMemo<ExtensionFormContextValue>(
    () => ({
      invalidFields,
      setValue(name, value) {
        setValues((current) => ({ ...current, [name]: value }));
        setPayloadTooLarge(false);
      },
    }),
    [invalidFields],
  );

  return (
    <ExtensionFormContext.Provider value={context}>
      <form
        data-slot="extension-view-form"
        className="flex min-w-0 flex-col gap-3"
        aria-busy={pending || undefined}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (missingFields.length > 0) return;
          if (!extensionViewFormPayloadFits(values)) {
            setPayloadTooLarge(true);
            return;
          }
          void run(node.onSubmit, [values]);
        }}
      >
        <div className="flex min-w-0 flex-col gap-2">{renderChildren(node.children)}</div>
        {attempted && missingFields.length > 0 ? (
          <div role="alert" className="text-destructive ui-text-sm">
            Complete the required fields before continuing.
          </div>
        ) : null}
        {payloadTooLarge ? (
          <div role="alert" className="text-destructive ui-text-sm">
            Form values must be smaller than{" "}
            {EXTENSION_VIEW_FORM_LIMITS.maxPayloadCharacters / 1000}
            KB.
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="accent"
            disabled={node.disabled || pending}
            aria-busy={pending || undefined}
          >
            {pending ? <Spinner compact label={node.pendingLabel ?? node.submitLabel} /> : null}
            {pending ? (node.pendingLabel ?? node.submitLabel) : node.submitLabel}
          </Button>
        </div>
      </form>
    </ExtensionFormContext.Provider>
  );
}

export function ExtensionButtonControl({ node, execute }: ExtensionControlProps<ButtonNode>) {
  const { pending, run } = usePendingAction(execute);

  return (
    <Button
      variant={node.tone ?? "default"}
      disabled={node.disabled || pending}
      aria-busy={pending || undefined}
      onClick={() => void run(node.action)}
    >
      {pending ? <Spinner compact label={node.pendingLabel ?? node.label} /> : null}
      {pending ? (node.pendingLabel ?? node.label) : node.label}
    </Button>
  );
}

export function ExtensionScreenActionControl({
  action,
  execute,
}: {
  action: ScreenAction;
  execute: ExtensionViewExecute;
}) {
  const { pending, run } = usePendingAction(execute);

  return (
    <Button
      iconOnly
      variant="ghost"
      tooltip={action.label}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => void run(action.action)}
    >
      {pending ? (
        <Spinner compact label={action.label} />
      ) : action.icon ? (
        <DynamicIcon name={action.icon} size={14} />
      ) : (
        action.label
      )}
    </Button>
  );
}

export function ExtensionInputControl({ node, execute }: ExtensionControlProps<InputNode>) {
  const [value, setValue] = useState(node.value ?? "");
  const formField = useFormField(node.name);

  return (
    <label className="flex min-w-0 flex-col gap-1 ui-text-sm text-subtle-foreground">
      {node.label ? <FieldLabelText label={node.label} required={node.required} /> : null}
      <Input
        name={node.name}
        value={value}
        placeholder={node.placeholder}
        type={node.inputType ?? "text"}
        required={node.required}
        maxLength={EXTENSION_VIEW_FORM_LIMITS.maxValueCharacters}
        aria-invalid={formField.invalid || undefined}
        disabled={node.disabled}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          setValue(nextValue);
          formField.update(nextValue);
          if (node.onChange) void execute(node.onChange, [nextValue]);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && node.onSubmit) {
            event.preventDefault();
            void execute(node.onSubmit, [value]);
          }
        }}
      />
      <RequiredFieldError invalid={formField.invalid} />
    </label>
  );
}

export function ExtensionTextareaControl({ node, execute }: ExtensionControlProps<TextareaNode>) {
  const [value, setValue] = useState(node.value ?? "");
  const formField = useFormField(node.name);

  return (
    <label className="flex min-w-0 flex-col gap-1 ui-text-sm text-subtle-foreground">
      {node.label ? <FieldLabelText label={node.label} required={node.required} /> : null}
      <Textarea
        name={node.name}
        value={value}
        placeholder={node.placeholder}
        rows={node.rows ?? 4}
        required={node.required}
        maxLength={EXTENSION_VIEW_FORM_LIMITS.maxValueCharacters}
        aria-invalid={formField.invalid || undefined}
        disabled={node.disabled}
        aria-keyshortcuts={node.onSubmit ? "Control+Enter Meta+Enter" : undefined}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          setValue(nextValue);
          formField.update(nextValue);
          if (node.onChange) void execute(node.onChange, [nextValue]);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && node.onSubmit) {
            event.preventDefault();
            void execute(node.onSubmit, [value]);
          }
        }}
      />
      <RequiredFieldError invalid={formField.invalid} />
    </label>
  );
}

export function ExtensionNumberInputControl({
  node,
  execute,
}: ExtensionControlProps<NumberInputNode>) {
  const [value, setValue] = useState(node.value);
  const formField = useFormField(node.name);

  return (
    <label className="flex min-w-0 flex-col gap-1 ui-text-sm text-subtle-foreground">
      {node.label ? <FieldLabelText label={node.label} required={node.required} /> : null}
      <NumberInput
        name={node.name}
        value={value}
        placeholder={node.placeholder}
        min={node.min}
        max={node.max}
        step={node.step}
        required={node.required}
        aria-invalid={formField.invalid || undefined}
        disabled={node.disabled}
        aria-label={node.label ?? node.placeholder ?? "Number"}
        onChange={(nextValue) => {
          setValue(nextValue);
          formField.update(nextValue);
          if (node.onChange) void execute(node.onChange, [nextValue]);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && node.onSubmit && value != null) {
            event.preventDefault();
            void execute(node.onSubmit, [value]);
          }
        }}
      />
      <RequiredFieldError invalid={formField.invalid} />
    </label>
  );
}

export function ExtensionSelectControl({ node, execute }: ExtensionControlProps<SelectNode>) {
  const [value, setValue] = useState(node.value ?? "");
  const formField = useFormField(node.name);

  return (
    <label className="flex min-w-0 flex-col gap-1 ui-text-sm text-subtle-foreground">
      {node.label ? <FieldLabelText label={node.label} required={node.required} /> : null}
      <Select
        value={value}
        options={node.options}
        placeholder={node.placeholder}
        disabled={node.disabled}
        variant="default"
        width="full"
        aria-label={node.label ?? node.placeholder ?? "Select an option"}
        onChange={(nextValue) => {
          setValue(nextValue);
          formField.update(nextValue);
          if (node.onChange) void execute(node.onChange, [nextValue]);
        }}
      />
      <RequiredFieldError invalid={formField.invalid} />
    </label>
  );
}

export function ExtensionToggleControl({ node, execute }: ExtensionControlProps<ToggleNode>) {
  const [checked, setChecked] = useState(node.checked);
  const formField = useFormField(node.name);

  return (
    <label className="flex min-w-0 items-center justify-between gap-3 rounded-lg px-1 py-1.5 ui-text-sm has-disabled:cursor-not-allowed">
      <span className="min-w-0">
        <span className="block text-foreground">
          <FieldLabelText label={node.label} required={node.required} />
        </span>
        {node.description ? (
          <span className="block text-subtle-foreground">{node.description}</span>
        ) : null}
        <RequiredFieldError invalid={formField.invalid} />
      </span>
      <Switch
        checked={checked}
        aria-required={node.required || undefined}
        aria-invalid={formField.invalid || undefined}
        disabled={node.disabled}
        onChange={(nextChecked) => {
          setChecked(nextChecked);
          formField.update(nextChecked);
          if (node.onChange) void execute(node.onChange, [nextChecked]);
        }}
      />
    </label>
  );
}

export function ExtensionCheckboxControl({ node, execute }: ExtensionControlProps<CheckboxNode>) {
  const [checked, setChecked] = useState(node.checked);
  const formField = useFormField(node.name);

  return (
    <label className="flex min-w-0 items-start gap-2 rounded-lg px-1 py-1.5 ui-text-sm has-disabled:cursor-not-allowed">
      <Checkbox
        checked={checked}
        aria-required={node.required || undefined}
        aria-invalid={formField.invalid || undefined}
        disabled={node.disabled}
        onCheckedChange={(nextChecked) => {
          setChecked(nextChecked);
          formField.update(nextChecked);
          if (node.onChange) void execute(node.onChange, [nextChecked]);
        }}
      />
      <span className="min-w-0">
        <span className="block text-foreground">
          <FieldLabelText label={node.label} required={node.required} />
        </span>
        {node.description ? (
          <span className="block text-subtle-foreground">{node.description}</span>
        ) : null}
        <RequiredFieldError invalid={formField.invalid} />
      </span>
    </label>
  );
}

export function ExtensionChoiceControl({ node, execute }: ExtensionControlProps<ChoiceNode>) {
  const [value, setValue] = useState<string | string[]>(node.value);
  const formField = useFormField(node.name);
  const options = node.options.map((option) => ({
    value: option.value,
    label: option.label,
    disabled: option.disabled,
  }));

  const control = node.multiple ? (
    <ToggleGroup
      type="multiple"
      value={Array.isArray(value) ? value : []}
      options={options}
      ariaLabel={node.label ?? "Choose options"}
      variant="segmented"
      disabled={node.disabled}
      onValueChange={(nextValue) => {
        setValue(nextValue);
        formField.update(nextValue);
        if (node.onChange) void execute(node.onChange, [nextValue]);
      }}
    />
  ) : (
    <ToggleGroup
      value={typeof value === "string" ? value : ""}
      options={options}
      ariaLabel={node.label ?? "Choose an option"}
      variant="segmented"
      disabled={node.disabled}
      onValueChange={(nextValue) => {
        setValue(nextValue);
        formField.update(nextValue);
        if (node.onChange) void execute(node.onChange, [nextValue]);
      }}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-1 ui-text-sm">
      {node.label ? (
        <div className="text-foreground">
          <FieldLabelText label={node.label} required={node.required} />
        </div>
      ) : null}
      {node.description ? <div className="text-subtle-foreground">{node.description}</div> : null}
      {control}
      <RequiredFieldError invalid={formField.invalid} />
    </div>
  );
}

export function ExtensionTabsControl({
  node,
  execute,
  renderChildren,
}: ExtensionControlProps<TabsNode> & {
  renderChildren: (children: ExtensionViewNode[]) => ReactNode;
}) {
  const fallbackValue = node.tabs.find((tab) => !tab.disabled)?.value ?? node.tabs[0].value;
  const [value, setValue] = useState(node.value ?? fallbackValue);

  return (
    <Tabs
      value={value}
      onValueChange={(nextValue) => {
        setValue(nextValue);
        if (node.onChange) execute(node.onChange, [nextValue]);
      }}
    >
      <TabsList variant="line" className="max-w-full overflow-x-auto">
        {node.tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} disabled={tab.disabled}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {node.tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="pt-1">
          <div className="flex min-w-0 flex-col gap-2">{renderChildren(tab.children)}</div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function ExtensionDisclosureControl({
  node,
  execute,
  renderChildren,
}: ExtensionControlProps<DisclosureNode> & {
  renderChildren: (children: ExtensionViewNode[]) => ReactNode;
}) {
  const [open, setOpen] = useState(node.open ?? false);

  return (
    <Accordion
      value={open ? ["content"] : []}
      onValueChange={(nextValue) => {
        const nextOpen = nextValue.includes("content");
        setOpen(nextOpen);
        if (node.onChange) execute(node.onChange, [nextOpen]);
      }}
    >
      <AccordionItem value="content">
        <AccordionTrigger>{node.title}</AccordionTrigger>
        <AccordionContent>
          {node.description ? (
            <p className="text-subtle-foreground ui-text-sm">{node.description}</p>
          ) : null}
          {renderChildren(node.children)}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
