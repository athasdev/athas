import {
  WarningCircleIcon as AlertCircle,
  CheckCircleIcon as CheckCircle,
  EyeIcon as Eye,
  EyeSlashIcon as EyeOff,
} from "@/ui/icons";
import type { Dispatch, FormEvent, Ref, SetStateAction } from "react";
import { Checkbox } from "@/ui/checkbox";
import { Field, FieldLabel } from "@/ui/field";
import Input from "@/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import Select from "@/ui/select";
import type { RemoteConnectionFormData } from "../types/remote.types";

const connectionTypeOptions = [
  { value: "ssh", label: "SSH" },
  { value: "sftp", label: "SFTP" },
];

interface ConnectionFormProps {
  formData: RemoteConnectionFormData;
  onChange: (updates: Partial<RemoteConnectionFormData>) => void;
  showPassword: boolean;
  onShowPasswordChange: Dispatch<SetStateAction<boolean>>;
  validationStatus: "idle" | "valid" | "invalid";
  errorMessage: string;
  testStatus: "idle" | "success" | "error";
  testMessage: string;
  disabled?: boolean;
  intro: string;
  idPrefix: string;
  formId?: string;
  nameInputRef?: Ref<HTMLInputElement>;
  selectMenuClassName?: string;
  onSubmit?: () => void;
}

export default function ConnectionForm({
  formData,
  onChange,
  showPassword,
  onShowPasswordChange,
  validationStatus,
  errorMessage,
  testStatus,
  testMessage,
  disabled = false,
  intro,
  idPrefix,
  formId,
  nameInputRef,
  selectMenuClassName,
  onSubmit,
}: ConnectionFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.();
  };

  return (
    <form id={formId} className="space-y-4" onSubmit={handleSubmit}>
      <p className="ui-text-sm text-subtle-foreground">{intro}</p>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>
          Connection Name <span className="text-subtle-foreground">*</span>
        </FieldLabel>
        <Input
          ref={nameInputRef}
          id={`${idPrefix}-name`}
          type="text"
          value={formData.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="My Server"
          size="md"
          disabled={disabled}
        />
      </Field>

      <div className="grid grid-cols-12 gap-3">
        <Field className="col-span-8">
          <FieldLabel htmlFor={`${idPrefix}-host`}>
            Host <span className="text-subtle-foreground">*</span>
          </FieldLabel>
          <Input
            id={`${idPrefix}-host`}
            type="text"
            value={formData.host}
            onChange={(event) => onChange({ host: event.target.value })}
            placeholder="192.168.1.100"
            size="md"
            disabled={disabled}
          />
        </Field>
        <Field className="col-span-4">
          <FieldLabel htmlFor={`${idPrefix}-port`}>Port</FieldLabel>
          <Input
            id={`${idPrefix}-port`}
            type="number"
            value={formData.port}
            onChange={(event) => onChange({ port: parseInt(event.target.value) || 22 })}
            placeholder="22"
            min="1"
            max="65535"
            size="md"
            disabled={disabled}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-type`}>Connection Type</FieldLabel>
        <Select
          id={`${idPrefix}-type`}
          value={formData.type}
          options={connectionTypeOptions}
          onChange={(value) => onChange({ type: value as RemoteConnectionFormData["type"] })}
          className="ui-text-sm"
          menuClassName={selectMenuClassName}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-username`}>
          Username <span className="text-subtle-foreground">*</span>
        </FieldLabel>
        <Input
          id={`${idPrefix}-username`}
          type="text"
          value={formData.username}
          onChange={(event) => onChange({ username: event.target.value })}
          placeholder="root"
          size="md"
          disabled={disabled}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-password`}>
          Password <span className="text-subtle-foreground">(optional)</span>
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={`${idPrefix}-password`}
            type={showPassword ? "text" : "password"}
            value={formData.password}
            onChange={(event) => onChange({ password: event.target.value })}
            placeholder="Leave empty to use key authentication"
            size="md"
            disabled={disabled}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              variant="ghost"
              onClick={() => onShowPasswordChange((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              tooltip={showPassword ? "Hide password" : "Show password"}
              size="icon-sm"
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>

      {formData.password ? (
        <Field orientation="horizontal">
          <Checkbox
            id={`${idPrefix}-save-credentials`}
            checked={!!formData.saveCredentials}
            onCheckedChange={(checked) => onChange({ saveCredentials: checked })}
            disabled={disabled}
          />
          <FieldLabel htmlFor={`${idPrefix}-save-credentials`} className="cursor-pointer">
            Save password for future connections
          </FieldLabel>
        </Field>
      ) : null}

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-keypath`}>
          Private Key Path <span className="text-subtle-foreground">(optional)</span>
        </FieldLabel>
        <Input
          id={`${idPrefix}-keypath`}
          type="text"
          value={formData.keyPath}
          onChange={(event) => onChange({ keyPath: event.target.value })}
          placeholder="~/.ssh/id_rsa"
          size="md"
          disabled={disabled}
        />
      </Field>

      {testStatus !== "idle" ? (
        <Marker tone={testStatus === "success" ? "success" : "error"}>
          <MarkerIcon>{testStatus === "success" ? <CheckCircle /> : <AlertCircle />}</MarkerIcon>
          <MarkerContent>{testMessage}</MarkerContent>
        </Marker>
      ) : null}

      {validationStatus === "valid" ? (
        <Marker tone="success">
          <MarkerIcon>
            <CheckCircle />
          </MarkerIcon>
          <MarkerContent>Connection saved successfully.</MarkerContent>
        </Marker>
      ) : null}

      {validationStatus === "invalid" ? (
        <Marker tone="error">
          <MarkerIcon>
            <AlertCircle />
          </MarkerIcon>
          <MarkerContent>{errorMessage}</MarkerContent>
        </Marker>
      ) : null}
    </form>
  );
}
