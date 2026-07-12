import {
  WarningCircleIcon as AlertCircle,
  CheckCircleIcon as CheckCircle,
  EyeIcon as Eye,
  EyeSlashIcon as EyeOff,
} from "@/ui/icons";
import type { Dispatch, FormEvent, Ref, SetStateAction } from "react";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
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
      <p className="ui-text-sm text-text-lighter">{intro}</p>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-name`} className="ui-text-sm font-medium text-text">
          Connection Name <span className="text-text-lighter">*</span>
        </label>
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
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-8 space-y-1.5">
          <label htmlFor={`${idPrefix}-host`} className="ui-text-sm font-medium text-text">
            Host <span className="text-text-lighter">*</span>
          </label>
          <Input
            id={`${idPrefix}-host`}
            type="text"
            value={formData.host}
            onChange={(event) => onChange({ host: event.target.value })}
            placeholder="192.168.1.100"
            size="md"
            disabled={disabled}
          />
        </div>
        <div className="col-span-4 space-y-1.5">
          <label htmlFor={`${idPrefix}-port`} className="ui-text-sm font-medium text-text">
            Port
          </label>
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
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-type`} className="ui-text-sm font-medium text-text">
          Connection Type
        </label>
        <Select
          id={`${idPrefix}-type`}
          value={formData.type}
          options={connectionTypeOptions}
          onChange={(value) => onChange({ type: value as RemoteConnectionFormData["type"] })}
          className="ui-text-sm"
          menuClassName={selectMenuClassName}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-username`} className="ui-text-sm font-medium text-text">
          Username <span className="text-text-lighter">*</span>
        </label>
        <Input
          id={`${idPrefix}-username`}
          type="text"
          value={formData.username}
          onChange={(event) => onChange({ username: event.target.value })}
          placeholder="root"
          size="md"
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-password`} className="ui-text-sm font-medium text-text">
          Password <span className="text-text-lighter">(optional)</span>
        </label>
        <div className="relative">
          <Input
            id={`${idPrefix}-password`}
            type={showPassword ? "text" : "password"}
            value={formData.password}
            onChange={(event) => onChange({ password: event.target.value })}
            placeholder="Leave empty to use key authentication"
            className="pr-10"
            size="md"
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => onShowPasswordChange((value) => !value)}
            className="-translate-y-1/2 absolute top-1/2 right-3 transform text-text-lighter hover:text-text"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>

      {formData.password ? (
        <label
          htmlFor={`${idPrefix}-save-credentials`}
          className="flex cursor-pointer items-center gap-2"
        >
          <Checkbox
            id={`${idPrefix}-save-credentials`}
            checked={!!formData.saveCredentials}
            onChange={(checked) => onChange({ saveCredentials: !!checked })}
            disabled={disabled}
          />
          <span className="ui-text-sm text-text">Save password for future connections</span>
        </label>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-keypath`} className="ui-text-sm font-medium text-text">
          Private Key Path <span className="text-text-lighter">(optional)</span>
        </label>
        <Input
          id={`${idPrefix}-keypath`}
          type="text"
          value={formData.keyPath}
          onChange={(event) => onChange({ keyPath: event.target.value })}
          placeholder="~/.ssh/id_rsa"
          size="md"
          disabled={disabled}
        />
      </div>

      {testStatus !== "idle" ? (
        <div
          className={cn(
            "ui-text-sm flex items-center gap-2",
            testStatus === "success" ? "text-success" : "text-error",
          )}
        >
          {testStatus === "success" ? <CheckCircle /> : <AlertCircle />}
          {testMessage}
        </div>
      ) : null}

      {validationStatus === "valid" ? (
        <div className="ui-text-sm flex items-center gap-2 text-success">
          <CheckCircle />
          Connection saved successfully.
        </div>
      ) : null}

      {validationStatus === "invalid" ? (
        <div className="ui-text-sm flex items-center gap-2 text-error">
          <AlertCircle />
          {errorMessage}
        </div>
      ) : null}
    </form>
  );
}
