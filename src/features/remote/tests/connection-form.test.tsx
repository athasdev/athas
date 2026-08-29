import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import ConnectionForm, {
  hasValidRemoteEndpoint,
  isRemoteConnectionFormValid,
} from "../components/connection-form";
import type { RemoteConnectionFormData } from "../types/remote.types";

const createFormData = (
  overrides: Partial<RemoteConnectionFormData> = {},
): RemoteConnectionFormData => ({
  name: "",
  host: "",
  port: 22,
  username: "",
  password: "",
  keyPath: "",
  type: "ssh",
  saveCredentials: false,
  ...overrides,
});

function renderConnectionForm(formData = createFormData()) {
  return renderToStaticMarkup(
    <ConnectionForm
      idPrefix="remote-test"
      formData={formData}
      onChange={vi.fn()}
      showPassword={false}
      onShowPasswordChange={vi.fn()}
      validationStatus="idle"
      errorMessage=""
      testStatus="idle"
      testMessage=""
      onChooseKey={vi.fn()}
    />,
  );
}

describe("ConnectionForm", () => {
  it("groups endpoint and authentication details with SSH guidance", () => {
    const markup = renderConnectionForm();

    expect(markup).toContain(">Connection</legend>");
    expect(markup).toContain(">Authentication</legend>");
    expect(markup).toContain("SSH config alias");
    expect(markup).toContain("Leave username blank");
    expect(markup).toContain("SSH agent are used automatically");
    expect(markup).toContain("Browse");
    expect(markup).not.toContain("Store password securely");
  });

  it("offers secure password storage only when a password is present", () => {
    const markup = renderConnectionForm(createFormData({ password: "secret" }));

    expect(markup).toContain("Store password securely for future connections");
  });

  it("accepts an SSH config alias without a username", () => {
    const formData = createFormData({ name: "Athas", host: "athas", username: "" });

    expect(hasValidRemoteEndpoint(formData)).toBe(true);
    expect(isRemoteConnectionFormValid(formData)).toBe(true);
  });
});
