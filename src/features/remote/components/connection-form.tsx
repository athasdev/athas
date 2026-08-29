import {
  WarningCircleIcon as AlertCircle,
  CheckCircleIcon as CheckCircle,
  EyeIcon as Eye,
  EyeSlashIcon as EyeOff,
  FolderOpenIcon as FolderOpen,
  KeyIcon as Key,
} from "@/ui/icons";
import type { Dispatch, FormEvent, Ref, SetStateAction } from "react";
import { Checkbox } from "@/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/ui/field";
import Input from "@/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import Select from "@/ui/select";
import type { RemoteConnectionFormData } from "../types/remote.types";

const connectionTypeOptions = [
  { value: "ssh", label: "SSH" },
  { value: "sftp", label: "SFTP" },
];

export function hasValidRemoteEndpoint(formData: RemoteConnectionFormData) {
  return Boolean(formData.host.trim() && formData.port >= 1 && formData.port <= 65535);
}

export function isRemoteConnectionFormValid(formData: RemoteConnectionFormData) {
  return Boolean(formData.name.trim() && hasValidRemoteEndpoint(formData));
}

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
  onChooseKey: () => void;
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
  onChooseKey,
}: ConnectionFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.();
  };

  return (
    <form id={formId} className="space-y-4" onSubmit={handleSubmit}>
      <FieldSet className="gap-2">
        <FieldLegend className="mb-0">Connection</FieldLegend>
        <FieldDescription>
          Name the workspace and enter a host, IP address, or SSH config alias.
        </FieldDescription>
        <FieldGroup className="gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-name`}>Connection name</FieldLabel>
              <Input
                ref={nameInputRef}
                id={`${idPrefix}-name`}
                type="text"
                value={formData.name}
                onChange={(event) => onChange({ name: event.target.value })}
                placeholder="Production server"
                disabled={disabled}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={`${idPrefix}-type`}>Workspace access</FieldLabel>
              <Select
                id={`${idPrefix}-type`}
                value={formData.type}
                options={connectionTypeOptions}
                onChange={(value) => onChange({ type: value as RemoteConnectionFormData["type"] })}
                width="full"
                variant="surface"
                disabled={disabled}
              />
            </Field>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-host`}>Host</FieldLabel>
              <Input
                id={`${idPrefix}-host`}
                type="text"
                value={formData.host}
                onChange={(event) => onChange({ host: event.target.value })}
                placeholder="server.example.com"
                disabled={disabled}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
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
                disabled={disabled}
                required
              />
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSet className="gap-2">
        <FieldLegend className="mb-0">Authentication</FieldLegend>
        <FieldDescription>
          Leave username blank to use SSH config. Your keys and SSH agent are used automatically.
        </FieldDescription>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-username`}>
              Username <span className="font-normal text-subtle-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id={`${idPrefix}-username`}
              type="text"
              value={formData.username}
              onChange={(event) => onChange({ username: event.target.value })}
              placeholder="root"
              disabled={disabled}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${idPrefix}-keypath`}>
              Private key <span className="font-normal text-subtle-foreground">(optional)</span>
            </FieldLabel>
            <InputGroup variant="surface">
              <InputGroupAddon align="inline-start">
                <Key />
              </InputGroupAddon>
              <InputGroupInput
                id={`${idPrefix}-keypath`}
                type="text"
                value={formData.keyPath}
                onChange={(event) => onChange({ keyPath: event.target.value })}
                placeholder="~/.ssh/id_ed25519"
                disabled={disabled}
                className="font-mono"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton onClick={onChooseKey} disabled={disabled}>
                  <FolderOpen />
                  Browse
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${idPrefix}-password`}>
              Password <span className="font-normal text-subtle-foreground">(optional)</span>
            </FieldLabel>
            <InputGroup variant="surface">
              <InputGroupInput
                id={`${idPrefix}-password`}
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={(event) => onChange({ password: event.target.value })}
                placeholder="Fallback password"
                disabled={disabled}
                autoComplete="current-password"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  onClick={() => onShowPasswordChange((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tooltip={showPassword ? "Hide password" : "Show password"}
                  iconOnly
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
              <FieldLabel htmlFor={`${idPrefix}-save-credentials`}>
                Store password securely for future connections
              </FieldLabel>
            </Field>
          ) : null}
        </FieldGroup>
      </FieldSet>

      <div className="space-y-2" aria-live="polite">
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
      </div>
    </form>
  );
}
