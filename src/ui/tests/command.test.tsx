import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { CommandForm, CommandFormField, CommandItemAction, CommandItemRow } from "../command";

describe("command compositions", () => {
  it("keeps inline forms on the shared inset surface and responsive field grid", () => {
    const markup = renderToStaticMarkup(
      <CommandForm title="Add remote" columns={2} submitLabel="Add remote" onSubmit={vi.fn()}>
        <CommandFormField label="Name" htmlFor="remote-name">
          <input id="remote-name" />
        </CommandFormField>
        <CommandFormField label="URL" htmlFor="remote-url">
          <input id="remote-url" />
        </CommandFormField>
      </CommandForm>,
    );

    expect(markup).toContain('data-command-form=""');
    expect(markup).toContain("bg-secondary-bg/65");
    expect(markup).toContain("sm:grid-cols-2");
    expect(markup).toContain('for="remote-name"');
    expect(markup).toContain('data-variant="accent"');
  });

  it("keeps destructive row actions visually constrained by the command primitive", () => {
    const markup = renderToStaticMarkup(
      <CommandItemRow
        title="origin"
        action={
          <CommandItemAction tone="danger" aria-label="Remove origin">
            Remove
          </CommandItemAction>
        }
      />,
    );

    expect(markup).toContain("group/command-item");
    expect(markup).toContain('data-variant="danger"');
    expect(markup).toContain("group-hover/command-item:opacity-100");
  });
});
