//! An extension's page (`extension-detail-view.tsx`): what it is, what it adds, what it may
//! do, and the actions that install, update, remove, enable or disable it.

use extensions::{
    CatalogEntry, ExtensionManifest, ExtensionStatus, McpServerConfig, Operation, ToolDescriptor, ToolKind, ToolState,
    ToolStatuses, manifest::ToolRuntime,
};
use ui::scale::px;
use ui::OpenOutbound;
use gpui::{AnyElement, ClickEvent, Context, Hsla, SharedString, div, img, prelude::*,};
use theme::{ActiveTheme, ThemeColors};
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, Switch, WithScrollbar, metrics, pane_header, typography};

use crate::{
    ExtensionsView, ExtensionsViewEvent,
    widgets::{extension_icon, format_size, operation_label, progress_bar, status_badge},
};

/// Files the icon theme preview shows.
const ICON_PREVIEW: &[(&str, bool)] =
    &[("src", true), ("main.rs", false), ("index.ts", false), ("package.json", false), ("README.md", false), ("Dockerfile", false)];

pub(crate) fn render(
    view: &mut ExtensionsView,
    entry: &CatalogEntry,
    colors: &ThemeColors,
    cx: &mut Context<ExtensionsView>,
) -> AnyElement {
    let manifest = entry.manifest.clone();
    let status = extensions::get(cx).status(&manifest.id, settings::get(cx));

    let embedded = view.embedded();
    let breadcrumb = pane_header(cx)
        .px(if embedded { px(0.) } else { px(8.) })
        .child(
            Button::icon("extension-back", IconName::ArrowLeft)
                .size(ButtonSize::Small)
                .tooltip("Back to Extensions")
                .on_click(cx.listener(|this, _, _, cx| this.back(cx))),
        )
        .child(crumb("extension-crumb-all", "Integrations", colors).on_click(cx.listener(|this, _, _, cx| this.show_category("all", cx))))
        .child(Icon::new(IconName::ChevronRight).size(IconSize::XSmall).color(colors.subtle_foreground))
        .child({
            let kind = entry.kind;
            crumb("extension-crumb-kind", kind.label(), colors).on_click(cx.listener(move |this, _, _, cx| this.show_category(kind.id(), cx)))
        })
        .child(Icon::new(IconName::ChevronRight).size(IconSize::XSmall).color(colors.subtle_foreground))
        .child(div().min_w_0().truncate().font_weight(typography::MEDIUM).text_color(colors.foreground).child(manifest.display_name.clone()));

    let mut subtitle = format!("{} · v{}", manifest.publisher, manifest.version);
    if let Some(installed) = status.installed_version.as_ref().filter(|installed| **installed != manifest.version) {
        subtitle.push_str(&format!(" · v{installed} installed"));
    }

    let header = div()
        .flex()
        .gap(px(16.))
        .child(extension_icon(entry, px(56.), colors))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(4.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(typography::text_lg())
                                .font_weight(typography::SEMIBOLD)
                                .text_color(colors.foreground)
                                .child(manifest.display_name.clone()),
                        )
                        .children(status_badge(&status, colors)),
                )
                .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(subtitle))
                .child(div().pt(px(2.)).text_size(typography::text_base()).text_color(colors.muted_foreground).child(manifest.description.clone()))
                .child(render_actions(entry, &status, colors, cx)),
        );

    let tool_statuses = extensions::get(cx).tool_statuses(&manifest.id);
    // `ExtensionDetailView`: Details first, then what it contributes.
    let mut sections = vec![section("Contributes", render_contributions(entry, colors, cx), colors)];
    if let Some(sandboxes) = render_running_sandboxes(view, entry, &status, colors, cx) {
        let provider = entry.manifest.sandbox_providers().next().map(|provider| provider.id.clone());
        let refresh = provider.map(|provider| {
            Button::new("sandboxes-refresh", "Refresh")
                .leading_icon(IconName::ArrowClockwise)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.refresh_sandboxes(&provider, cx)))
                .into_any_element()
        });
        sections.insert(0, section_with_action("Sandboxes", sandboxes, refresh, colors));
    }
    if let Some(keys) = render_sandbox_keys(view, entry, &status, colors, cx) {
        sections.insert(0, section("API Key", keys, colors));
    }
    if let Some(statuses) = &tool_statuses {
        sections.push(section_with_action("Language Tools", render_tools(&manifest, statuses, colors), tools_action(&manifest.id, statuses, cx), colors));
    }
    if let Some(permissions) = render_permissions(&manifest, colors) {
        sections.push(section("Permissions", permissions, colors));
    }

    let body = div()
        .flex()
        .flex_col()
        .gap(px(20.))
        .w_full()
        .when(!embedded, |this| this.max_w(px(760.)).mx_auto().px(px(24.)).pt(px(16.)).pb(px(32.)))
        .child(header)
        .children(status.error.clone().map(|error| render_error(&manifest.id, error, colors, cx)))
        .children(
            tool_statuses
                .as_ref()
                .filter(|_| status.installed && status.error.is_none())
                .and_then(ToolStatuses::issue)
                .map(|(kind, message)| render_tool_issue(kind, message, colors)),
        )
        .children(sections);

    // As a page of Settings the page scrolls the extension; on its own the view does.
    if embedded {
        return div().flex().flex_col().w_full().gap(px(12.)).child(breadcrumb).child(body).into_any_element();
    }
    div()
        .flex()
        .flex_col()
        .flex_1()
        .min_h_0()
        .child(breadcrumb)
        .child(div().id("extension-detail").flex_1().min_h_0().overflow_y_scroll().child(body).scrollbar_with(&view.detail_scroll))
        .into_any_element()
}

fn crumb(id: &'static str, label: &'static str, colors: &ThemeColors) -> gpui::Stateful<gpui::Div> {
    let hover = colors.foreground;
    div()
        .id(id)
        .flex_none()
        .px(px(4.))
        .rounded(metrics::radius())
        .text_color(colors.subtle_foreground)
        .hover(move |style| style.text_color(hover))
        .child(label)
}

fn render_actions(
    entry: &CatalogEntry,
    status: &ExtensionStatus,
    colors: &ThemeColors,
    cx: &mut Context<ExtensionsView>,
) -> AnyElement {
    let id = entry.manifest.id.clone();
    let mut row = div().flex().flex_wrap().items_center().gap(px(8.)).pt(px(8.));

    if let Some(operation) = status.operation {
        let fraction = match operation {
            Operation::Installing(fraction) => fraction,
            Operation::Uninstalling => 1.,
        };
        return row
            .child(progress_bar(fraction, px(160.), colors))
            .child(div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(operation_label(operation)))
            .into_any_element();
    }

    if status.blocked && !status.installed {
        return row
            .child(Icon::new(IconName::ShieldCheck).size(IconSize::Small).color(colors.warning))
            .child(
                div()
                    .text_size(typography::text_sm())
                    .text_color(colors.muted_foreground)
                    .child("Your organization's extension allowlist does not include this extension."),
            )
            .into_any_element();
    }

    if !status.installed {
        let install_id = id.clone();
        let size = entry.manifest.package_for(&platform()).map(|package| format!(" · {}", format_size(package.size)));
        row = row.child(
            Button::new("extension-install", "Install")
                .leading_icon(IconName::Download)
                .variant(ButtonVariant::Accent)
                .size(ButtonSize::Small)
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.install(&install_id, cx))),
        );
        if let Some(size) = size {
            row = row.child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(size.trim_start_matches(" · ").to_string()));
        }
        return row.into_any_element();
    }

    // Everything that acts on the extension is one joined control: Update, what it contributes,
    // its key, Uninstall. Separately they read as four unrelated buttons on a page that has no
    // other buttons; joined they read as the one place this extension is acted on.
    let mut actions: Vec<AnyElement> = Vec::new();

    if status.update_available {
        let update_id = id.clone();
        actions.push(
            Button::new("extension-update", "Update")
                .leading_icon(IconName::ArrowClockwise)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tone(ui::ButtonTone::Accent)
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.install(&update_id, cx)))
                .into_any_element(),
        );
    }

    if status.enabled {
        let manifest = &entry.manifest;
        if let Some(theme) = manifest.themes().next() {
            let current = &cx.theme().id;
            let in_use = manifest.themes().any(|theme| theme.id == *current);
            let theme_id = theme.id.clone();
            actions.push(
                Button::new("extension-use-theme", if in_use { "Theme in Use" } else { "Use Theme" })
                    .leading_icon(IconName::Palette)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .disabled(in_use)
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.use_theme(&theme_id, cx)))
                    .into_any_element(),
            );
        }
        if let Some(icon_theme) = manifest.icon_themes().next() {
            let active = extensions::active_icon_theme_id(cx);
            let in_use = manifest.icon_themes().any(|theme| theme.id == active);
            let icon_theme_id = icon_theme.id.clone();
            let several = manifest.icon_themes().count() > 1;
            actions.push(
                Button::new("extension-use-icons", if in_use { "Icons in Use" } else { "Use Icons" })
                    .leading_icon(IconName::Files)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .disabled(in_use && !several)
                    .on_click(cx.listener(move |_, _: &ClickEvent, _, cx| {
                        if several {
                            cx.emit(ExtensionsViewEvent::SelectIconTheme);
                        } else {
                            extensions::set_icon_theme(&icon_theme_id, cx);
                        }
                    }))
                    .into_any_element(),
            );
        }
        // A sandbox provider is installed the moment its manifest is: the provider itself is
        // built into Athas. What is still missing is the key, so that is the action an installed
        // one offers. Making the key is a trip to the provider's dashboard.
        if let Some(url) = manifest.sandbox_providers().find_map(|provider| provider.api_key_url.clone()) {
            actions.push(
                Button::new("extension-sandbox-key", "Get a Key")
                    .leading_icon(IconName::Key)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .on_click(move |_: &ClickEvent, _, cx| cx.open_outbound(&url))
                    .into_any_element(),
            );
        }
    }

    let uninstall_id = id.clone();
    actions.push(
        Button::new("extension-uninstall", "Uninstall")
            .leading_icon(IconName::Trash)
            .variant(ButtonVariant::Ghost)
            .size(ButtonSize::Small)
            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.uninstall(&uninstall_id, cx)))
            .into_any_element(),
    );

    let mut group = ui::ButtonGroup::new();
    for (index, action) in actions.into_iter().enumerate() {
        if index > 0 {
            group = group.child(ui::ButtonGroupSeparator::new());
        }
        group = group.child(action);
    }
    row = row.child(group);

    let enabled = status.enabled;
    let toggle_id = id.clone();
    let view = cx.entity().downgrade();
    row.child(
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .ml(px(4.))
            .text_size(typography::text_sm())
            .text_color(colors.muted_foreground)
            .child(Switch::new("extension-enabled", enabled).on_change(move |enabled, _, cx| {
                view.update(cx, |view, cx| view.set_enabled(&toggle_id, enabled, cx)).ok();
            }))
            .child(if enabled { "Enabled" } else { "Disabled" }),
    )
    .into_any_element()
}

fn platform() -> String {
    #[cfg(not(target_family = "wasm"))]
    return extensions::installer::platform();
    #[cfg(target_family = "wasm")]
    "web".to_string()
}

fn render_error(id: &str, error: SharedString, colors: &ThemeColors, cx: &mut Context<ExtensionsView>) -> AnyElement {
    let id = id.to_string();
    div()
        .flex()
        .items_start()
        .gap(px(8.))
        .px(px(12.))
        .py(px(8.))
        .rounded(metrics::radius_lg())
        .bg(colors.destructive_soft)
        .child(div().pt(px(1.)).child(Icon::new(IconName::WarningCircle).size(IconSize::Small).color(colors.destructive)))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(2.))
                .text_size(typography::text_sm())
                .child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child("The extension could not be installed"))
                .child(div().text_color(colors.muted_foreground).child(error)),
        )
        .child(
            Button::icon("extension-dismiss-error", IconName::X)
                .size(ButtonSize::XSmall)
                .tooltip("Dismiss")
                .on_click(cx.listener(move |_, _, _, cx| extensions::dismiss_error(&id, cx))),
        )
        .into_any_element()
}

fn section(title: &'static str, body: AnyElement, colors: &ThemeColors) -> AnyElement {
    section_with_action(title, body, None, colors)
}

fn section_with_action(title: &'static str, body: AnyElement, action: Option<AnyElement>, colors: &ThemeColors) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap(px(8.))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .min_h(px(24.))
                .child(
                    div()
                        .text_size(typography::text_sm())
                        .font_weight(typography::SEMIBOLD)
                        .text_color(colors.foreground)
                        .child(title),
                )
                .children(action),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .rounded(metrics::radius_lg())
                .border_1()
                .border_color(colors.divider)
                .overflow_hidden()
                .child(body),
        )
        .into_any_element()
}

/// One line of a section: a label column and its value.
/// The key each of this extension's sandbox providers is reached with: what is saved, and the
/// one place to type a new one. Only for an installed extension -- a provider that is not on is
/// not asking for anything.
fn render_sandbox_keys(
    view: &ExtensionsView,
    entry: &CatalogEntry,
    status: &ExtensionStatus,
    colors: &ThemeColors,
    cx: &mut Context<ExtensionsView>,
) -> Option<AnyElement> {
    if !status.installed {
        return None;
    }
    let providers: Vec<_> = entry.manifest.sandbox_providers().cloned().collect();
    if providers.is_empty() {
        return None;
    }
    let rows = providers.into_iter().enumerate().map(|(index, provider)| {
        let id = provider.id.clone();
        let editing = view.editing_key() == Some(id.as_str());
        let saved = view.sandbox_key(&id);
        let detail: SharedString = match &saved {
            _ if view.checking_key() => format!("Checking the key with {}…", provider.name).into(),
            _ if editing => "The key is kept in this computer's keychain, never in settings.".into(),
            Some(Some(mask)) => format!("Saved in the keychain · {mask}").into(),
            Some(None) => "Not set. Athas cannot reach this provider without it.".into(),
            None => "Checking the keychain…".into(),
        };
        let control = if editing {
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .child(div().w(px(260.)).child(view.key_field()))
                .child(
                    Button::new(("sandbox-key-save", index), "Save")
                        .variant(ButtonVariant::Accent)
                        .size(ButtonSize::Small)
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.save_key(cx))),
                )
                .child(
                    Button::new(("sandbox-key-cancel", index), "Cancel")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.cancel_key_entry(cx))),
                )
                .into_any_element()
        } else {
            let has_key = matches!(saved, Some(Some(_)));
            let edit_id = id.clone();
            let remove_id = id.clone();
            let mut group = ui::ButtonGroup::new().child(
                Button::new(("sandbox-key-edit", index), if has_key { "Replace" } else { "Add Key" })
                    .leading_icon(IconName::Key)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| this.start_key_entry(&edit_id, window, cx))),
            );
            if has_key {
                group = group.child(ui::ButtonGroupSeparator::new()).child(
                    Button::new(("sandbox-key-remove", index), "Remove")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.remove_key(&remove_id, cx))),
                );
            }
            group.into_any_element()
        };
        let name = div()
            .flex()
            .items_center()
            .gap(px(6.))
            .child(provider.name.clone())
            .when(matches!(saved, Some(Some(_))), |this| {
                this.child(Icon::new(IconName::CheckCircle).size(IconSize::XSmall).color(colors.success))
            });
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(12.))
            .px(px(12.))
            .py(px(8.))
            .border_b_1()
            .border_color(colors.divider)
            .text_size(typography::text_sm())
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w(px(200.))
                    .gap(px(2.))
                    .child(div().text_color(colors.foreground).child(name))
                    .child(div().text_color(colors.muted_foreground).child(detail)),
            )
            .child(control)
            .into_any_element()
    });
    let error = view.key_error().map(|message| {
        div()
            .px(px(12.))
            .py(px(8.))
            .text_size(typography::text_sm())
            .text_color(colors.destructive)
            .border_b_1()
            .border_color(colors.divider)
            .child(message)
    });
    Some(
        div()
            .flex()
            .flex_col()
            .children(rows)
            .children(error)
            .into_any_element(),
    )
}

/// What the account has right now, with what each one is made of and when the provider will
/// stop it. The point of a key is that this can be asked at all, so it is the first thing a
/// working key shows.
fn render_running_sandboxes(
    view: &ExtensionsView,
    entry: &CatalogEntry,
    status: &ExtensionStatus,
    colors: &ThemeColors,
    cx: &mut Context<ExtensionsView>,
) -> Option<AnyElement> {
    if !status.installed {
        return None;
    }
    let provider = entry.manifest.sandbox_providers().next()?;
    let id = provider.id.clone();
    let listed = view.sandbox_key(&id).flatten().and(view.provider_sandboxes(&id))?;
    let line = |content: AnyElement| {
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(12.))
            .px(px(12.))
            .py(px(8.))
            .border_b_1()
            .border_color(colors.divider)
            .text_size(typography::text_sm())
            .child(content)
    };
    if listed.is_empty() {
        return Some(
            line(div().text_color(colors.muted_foreground).child("No sandboxes right now.").into_any_element()).into_any_element(),
        );
    }
    let rows = listed.iter().enumerate().map(|(index, sandbox)| {
        let stop_id = sandbox.id.clone();
        let provider_id = id.clone();
        let state: SharedString = if sandbox.is_running() { "Running".into() } else { sandbox.state.clone().into() };
        let mut detail = vec![sandbox.template.clone()].into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>();
        if sandbox.cpus > 0 {
            detail.push(format!("{} vCPU", sandbox.cpus));
        }
        if sandbox.memory_mb > 0 {
            detail.push(format!("{} MB", sandbox.memory_mb));
        }
        if let Some(left) = sandbox.ends_at.as_deref().and_then(time_left) {
            detail.push(left);
        }
        line(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w(px(200.))
                .gap(px(2.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(mono(sandbox.id.clone(), colors))
                        .child(div().text_color(colors.muted_foreground).child(state)),
                )
                .child(div().text_color(colors.subtle_foreground).child(detail.join(" · ")))
                .into_any_element(),
        )
        .child(
            Button::new(("sandbox-stop", index), "Stop")
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.stop_sandbox(&provider_id, &stop_id, cx))),
        )
        .into_any_element()
    });
    Some(div().flex().flex_col().children(rows).into_any_element())
}

/// How long the provider will leave a sandbox alone, from the moment it says it will stop it.
/// `None` when the time has passed or cannot be read: a countdown that has run out says nothing.
fn time_left(ends_at: &str) -> Option<String> {
    let ends = chrono::DateTime::parse_from_rfc3339(ends_at).ok()?;
    let minutes = (ends.timestamp() - chrono::Utc::now().timestamp()) / 60;
    match minutes {
        ..=0 => None,
        1..=59 => Some(format!("stops in {minutes}m")),
        _ => Some(format!("stops in {}h{:02}m", minutes / 60, minutes % 60)),
    }
}

fn item(label: impl Into<SharedString>, value: impl IntoElement, detail: Option<SharedString>, colors: &ThemeColors) -> AnyElement {
    div()
        .flex()
        .gap(px(12.))
        .px(px(12.))
        .py(px(8.))
        .border_b_1()
        .border_color(colors.divider)
        .text_size(typography::text_sm())
        .child(div().flex_none().w(px(150.)).text_color(colors.subtle_foreground).child(label.into()))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(2.))
                .text_color(colors.foreground)
                .child(value)
                .children(detail.map(|detail| div().text_color(colors.muted_foreground).child(detail))),
        )
        .into_any_element()
}

fn mono(text: impl Into<SharedString>, colors: &ThemeColors) -> impl IntoElement {
    div()
        .font_family(typography::MONO_FONT)
        .text_size(typography::text_caption())
        .text_color(colors.foreground)
        .child(text.into())
}

/// The tool and how it installs: `prettier (bun)`.
fn tool_line(tool: &ToolDescriptor) -> String {
    let runtime = match tool.runtime {
        ToolRuntime::Bun => "bun",
        ToolRuntime::Node => "node",
        ToolRuntime::Python => "python",
        ToolRuntime::Go => "go",
        ToolRuntime::Rust => "cargo",
        ToolRuntime::Ruby => "gem",
        ToolRuntime::R => "R",
        ToolRuntime::System => "system",
        ToolRuntime::Binary => "binary download",
    };
    let package = tool.package.as_deref().filter(|package| *package != tool.name);
    match package {
        Some(package) => format!("{} ({runtime}, {package})", tool.name),
        None => format!("{} ({runtime})", tool.name),
    }
}

fn swatch(color: Option<&String>) -> Option<AnyElement> {
    let color: Hsla = theme::parse_color(color?)?.into();
    Some(div().size(px(14.)).rounded_full().bg(color).border_1().border_color(gpui::black().opacity(0.15)).into_any_element())
}

fn render_contributions(entry: &CatalogEntry, colors: &ThemeColors, cx: &mut Context<ExtensionsView>) -> AnyElement {
    let manifest = &entry.manifest;
    let mut items = Vec::new();

    for language in manifest.languages() {
        let mut files: Vec<String> = language.extensions.clone();
        files.extend(language.filenames.iter().cloned());
        items.push(item(
            "Language",
            div().child(language.aliases.first().cloned().unwrap_or_else(|| language.id.clone())),
            (!files.is_empty()).then(|| files.join("  ").into()),
            colors,
        ));
    }
    for theme in manifest.themes() {
        let swatches = div()
            .flex()
            .items_center()
            .gap(px(6.))
            .children(["background", "surface", "foreground", "primary"].into_iter().filter_map(|key| swatch(theme.colors.get(key))))
            .child(div().pl(px(4.)).child(theme.name.clone()));
        let appearance = if theme.appearance == "light" { "Light" } else { "Dark" };
        items.push(item("Colour theme", swatches, Some(theme.description.clone().map_or(appearance.into(), |description| format!("{appearance} · {description}").into())), colors));
    }
    let dark = cx.theme().appearance.is_dark();
    for contribution in manifest.icon_themes() {
        let loaded = extensions::get(cx).icon_theme(&contribution.id).cloned();
        let value = div().flex().flex_col().gap(px(6.)).child(contribution.name.clone()).children(loaded.map(|theme| {
            div().flex().items_center().gap(px(12.)).children(ICON_PREVIEW.iter().filter_map(|(name, is_dir)| {
                let source = theme.icon(name, *is_dir, false, dark)?;
                Some(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .text_size(typography::text_caption())
                        .text_color(colors.muted_foreground)
                        .child(img(source).size(px(16.)))
                        .child(name.to_string()),
                )
            }))
        }));
        items.push(item("Icon theme", value, contribution.description.clone().map(Into::into), colors));
    }
    for server in manifest.mcp_servers() {
        let (transport, target) = match &server.config {
            McpServerConfig::Stdio { command, args, .. } => ("stdio", format!("{command} {}", args.join(" "))),
            McpServerConfig::Http { url, .. } => ("HTTP", url.clone()),
            McpServerConfig::Sse { url, .. } => ("SSE", url.clone()),
        };
        let needs = match &server.config {
            McpServerConfig::Stdio { env, .. } => env.clone(),
            McpServerConfig::Http { headers, .. } | McpServerConfig::Sse { headers, .. } => headers.clone(),
        };
        let mut detail = server.setup_note.clone().unwrap_or_default();
        if !needs.is_empty() && detail.is_empty() {
            detail = format!("Needs {}", needs.join(", "));
        }
        items.push(item(
            format!("MCP server ({transport})"),
            div().flex().flex_col().gap(px(2.)).child(server.name.clone()).child(mono(target.trim().to_string(), colors)),
            (!detail.is_empty()).then(|| detail.into()),
            colors,
        ));
    }
    for agent in manifest.agents() {
        let install = agent
            .install
            .as_ref()
            .and_then(|install| install.get("package").or_else(|| install.get("runtime")))
            .and_then(|value| value.as_str())
            .map(|package| format!("Installs {package}"));
        items.push(item(
            "ACP agent",
            div().flex().flex_col().gap(px(2.)).child(agent.name.clone()).child(mono(agent.binary_name.clone(), colors)),
            install.map(Into::into),
            colors,
        ));
    }
    for skill in manifest.skills() {
        let detail = match (&skill.description, skill.tags.is_empty()) {
            (Some(description), true) => description.clone(),
            (Some(description), false) => format!("{description} · {}", skill.tags.join(", ")),
            (None, _) => skill.tags.join(", "),
        };
        items.push(item("Skill", div().child(skill.name.clone()), (!detail.is_empty()).then(|| detail.into()), colors));
    }
    for provider in manifest.sandbox_providers() {
        items.push(item("Sandbox", div().child(provider.name.clone()), provider.description.clone().map(Into::into), colors));
    }
    for integration in manifest.integrations() {
        items.push(item("App", div().child(integration.name.clone()), integration.description.clone().map(Into::into), colors));
    }
    if manifest.ai_providers().next().is_some() || manifest.main.is_some() {
        items.push(item("Extension view", div().child("Runs its own view inside Athas"), None, colors));
    }
    if items.is_empty() {
        items.push(item("Nothing", div().text_color(colors.muted_foreground).child("This extension declares no contributions."), None, colors));
    }
    div().flex().flex_col().children(items).into_any_element()
}

fn render_tool_issue(kind: ToolKind, message: SharedString, colors: &ThemeColors) -> AnyElement {
    div()
        .flex()
        .items_start()
        .gap(px(8.))
        .px(px(12.))
        .py(px(8.))
        .rounded(metrics::radius_lg())
        .bg(colors.destructive_soft)
        .child(div().pt(px(1.)).child(Icon::new(IconName::WarningCircle).size(IconSize::Small).color(colors.destructive)))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(2.))
                .text_size(typography::text_sm())
                .child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(format!("The {} could not be installed", kind.label().to_lowercase())))
                .child(div().text_color(colors.muted_foreground).child(message)),
        )
        .into_any_element()
}

/// Install, reinstall or check the tools again, unless they are installing.
fn tools_action(id: &str, statuses: &ToolStatuses, cx: &mut Context<ExtensionsView>) -> Option<AnyElement> {
    if statuses.is_installing() {
        return None;
    }
    let all_installed = statuses.iter().all(|(_, state)| *state == ToolState::Installed);
    let install_id = id.to_string();
    let check_id = id.to_string();
    Some(
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(
                Button::icon("extension-tools-check", IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .tooltip("Check Again")
                    .on_click(cx.listener(move |_, _: &ClickEvent, _, cx| extensions::refresh_tool_status(&check_id, cx).detach())),
            )
            .child(
                Button::new("extension-tools-install", if all_installed { "Reinstall Tools" } else { "Install Tools" })
                    .leading_icon(IconName::Download)
                    .size(ButtonSize::Small)
                    .variant(if statuses.missing() { ButtonVariant::Accent } else { ButtonVariant::Ghost })
                    .on_click(cx.listener(move |_, _: &ClickEvent, _, cx| extensions::install_tools(&install_id, cx).detach())),
            )
            .into_any_element(),
    )
}

fn render_tools(manifest: &ExtensionManifest, statuses: &ToolStatuses, colors: &ThemeColors) -> AnyElement {
    let rows = statuses.iter().filter_map(|(kind, state)| {
        let tool = kind.descriptor(manifest)?;
        let state_element: AnyElement = match state {
            ToolState::Installing(fraction) => div()
                .flex()
                .items_center()
                .gap(px(8.))
                .text_size(typography::text_caption())
                .text_color(colors.muted_foreground)
                .child(progress_bar(*fraction, px(96.), colors))
                .child(if *fraction > 0. { format!("{}%", (fraction * 100.).round() as u32) } else { "Installing".into() })
                .into_any_element(),
            ToolState::Installed => ui::Badge::new("Installed").tone(ui::Tone::Success).into_any_element(),
            ToolState::NotInstalled => ui::Badge::new("Not installed").into_any_element(),
            ToolState::Failed(_) => ui::Badge::new("Failed").tone(ui::Tone::Danger).into_any_element(),
            ToolState::Unknown => ui::Badge::new("Checking").into_any_element(),
        };
        let detail = match state {
            ToolState::Failed(message) => Some(message.clone()),
            _ => (!tool.args.is_empty()).then(|| tool.args.join(" ").into()),
        };
        Some(item(
            kind.label(),
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .child(div().min_w_0().truncate().child(tool_line(tool)))
                .child(div().flex_none().child(state_element)),
            detail,
            colors,
        ))
    });
    div().flex().flex_col().children(rows.collect::<Vec<_>>()).into_any_element()
}

fn render_permissions(manifest: &ExtensionManifest, colors: &ThemeColors) -> Option<AnyElement> {
    let permissions = manifest.permissions.as_ref()?;
    let mut items = Vec::new();
    if !permissions.network.is_empty() {
        items.push(item("Network", mono(permissions.network.join("  "), colors), None, colors));
    }
    let flags = [
        (permissions.secrets, "Secrets", "Stores tokens in the system keychain"),
        (permissions.workspace.as_deref() == Some("read"), "Workspace", "Reads files in the open project"),
        (permissions.open_external, "Open links", "Opens pages in the browser"),
        (permissions.clipboard_write, "Clipboard", "Writes to the clipboard"),
    ];
    for (granted, label, description) in flags {
        if granted {
            items.push(item(label, div().child(description), None, colors));
        }
    }
    if !permissions.settings.is_empty() {
        items.push(item("Settings", mono(permissions.settings.join("  "), colors), None, colors));
    }
    (!items.is_empty()).then(|| div().flex().flex_col().children(items).into_any_element())
}

