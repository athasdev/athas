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
  idPrefix: string;
  formId?: string;
  nameInputRef?: Ref<HTMLInputElement>;
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
  idPrefix,
  formId,
  nameInputRef,
  onSubmit,
}: ConnectionFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.();
  };

  return (
    <form id={formId} className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>
          Name <span className="text-subtle-foreground">*</span>
        </FieldLabel>
        <Input
          ref={nameInputRef}
          id={`${idPrefix}-name`}
          type="text"
          value={formData.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="My Server"
          size="sm"
          disabled={disabled}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-type`}>Type</FieldLabel>
        <Select
          id={`${idPrefix}-type`}
          value={formData.type}
          options={connectionTypeOptions}
          onChange={(value) => onChange({ type: value as RemoteConnectionFormData["type"] })}
          size="sm"
          className="w-full"
        />
      </Field>

      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3 sm:col-span-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-host`}>
            Host <span className="text-subtle-foreground">*</span>
          </FieldLabel>
          <Input
            id={`${idPrefix}-host`}
            type="text"
            value={formData.host}
            onChange={(event) => onChange({ host: event.target.value })}
            placeholder="192.168.1.100"
            size="sm"
            disabled={disabled}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-port`}>Port</FieldLabel>
          <Input
            id={`${idPrefix}-port`}
            type="number"
            value={formData.port}
            onChange={(event) => onChange({ port: parseInt(event.target.value) || 22 })}
            placeholder="22"
            min="1"
            max="65535"
            size="sm"
            disabled={disabled}
          />
        </Field>
      </div>

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
          size="sm"
          disabled={disabled}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-keypath`}>
          Private Key <span className="text-subtle-foreground">(optional)</span>
        </FieldLabel>
        <Input
          id={`${idPrefix}-keypath`}
          type="text"
          value={formData.keyPath}
          onChange={(event) => onChange({ keyPath: event.target.value })}
          placeholder="~/.ssh/id_ed25519"
          size="sm"
          disabled={disabled}
        />
      </Field>

      <Field className="sm:col-span-2">
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
            size="sm"
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
        <Field orientation="horizontal" className="sm:col-span-2">
          <Checkbox
            id={`${idPrefix}-save-credentials`}
            checked={!!formData.saveCredentials}
            onCheckedChange={(checked) => onChange({ saveCredentials: checked })}
            disabled={disabled}
          />
          <FieldLabel htmlFor={`${idPrefix}-save-credentials`}>
            Save password for future connections
          </FieldLabel>
        </Field>
      ) : null}

      {testStatus !== "idle" ? (
        <Marker tone={testStatus === "success" ? "success" : "error"} className="sm:col-span-2">
          <MarkerIcon>{testStatus === "success" ? <CheckCircle /> : <AlertCircle />}</MarkerIcon>
          <MarkerContent>{testMessage}</MarkerContent>
        </Marker>
      ) : null}

      {validationStatus === "valid" ? (
        <Marker tone="success" className="sm:col-span-2">
          <MarkerIcon>
            <CheckCircle />
          </MarkerIcon>
          <MarkerContent>Connection saved successfully.</MarkerContent>
        </Marker>
      ) : null}

      {validationStatus === "invalid" ? (
        <Marker tone="error" className="sm:col-span-2">
          <MarkerIcon>
            <AlertCircle />
          </MarkerIcon>
          <MarkerContent>{errorMessage}</MarkerContent>
        </Marker>
      ) : null}
    </form>
  );
}
