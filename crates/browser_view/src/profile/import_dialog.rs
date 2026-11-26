//! Import from browser: pick a browser profile, pick the sites to stay signed in to, and their
//! cookies move into Athas's browser profile.

use std::{collections::HashSet, ops::Range};

use gpui::{
    AnyElement, App, ClickEvent, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, ScrollStrategy, Subscription,
    UniformListScrollHandle, Window, div, prelude::*, uniform_list,
};
use ui::{
    Button, ButtonVariant, Checkbox, Dialog, DialogLayout, DialogSize, EmptyState, Icon, IconName, IconSize, InputAppearance, InputGroup,
    Plane, Spinner, TextInput, TextInputEvent, metrics, prelude::*, scale::px,
};

use super::import::{self, Found, ImportError, Source};
use crate::host::HostRef;

const SITE_ROW_HEIGHT: f32 = 32.;
const SITE_LIST_HEIGHT: f32 = 320.;

enum Step {
    Choose,
    Reading(Source),
    Pick { source: Source, found: Found, selected: HashSet<String> },
    Importing(Source),
    Failed { source: Source, error: ImportError },
}

pub struct ImportDialog {
    sources: Vec<Source>,
    step: Step,
    host: HostRef,
    query: Entity<TextInput>,
    /// The sites the search leaves, as indices into the found sites.
    visible: Vec<usize>,
    scroll: UniformListScrollHandle,
    focus_handle: FocusHandle,
    _subscription: Subscription,
}

impl EventEmitter<DismissEvent> for ImportDialog {}

/// The dialog finished an import: the page reloads to use it.
pub struct Imported;

impl EventEmitter<Imported> for ImportDialog {}

impl Focusable for ImportDialog {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        match self.step {
            Step::Pick { .. } => self.query.focus_handle(cx),
            _ => self.focus_handle.clone(),
        }
    }
}

impl ImportDialog {
    pub fn new(host: HostRef, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let query = cx.new(|cx| TextInput::new(window, cx).placeholder("Search sites").appearance(InputAppearance::Bare));
        let subscription = cx.subscribe(&query, |this, _, event: &TextInputEvent, cx| {
            if let TextInputEvent::Changed(_) = event {
                this.filter(cx);
            }
        });
        Self {
            sources: import::sources(),
            step: Step::Choose,
            host,
            query,
            visible: Vec::new(),
            scroll: UniformListScrollHandle::new(),
            focus_handle: cx.focus_handle(),
            _subscription: subscription,
        }
    }

    fn read(&mut self, source: Source, window: &mut Window, cx: &mut Context<Self>) {
        self.step = Step::Reading(source.clone());
        cx.notify();
        let reading = cx.background_spawn({
            let source = source.clone();
            async move { import::read(&source) }
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = reading.await;
            this.update_in(cx, |this, window, cx| {
                this.step = match result {
                    Ok(found) if found.sites.is_empty() => Step::Failed {
                        error: ImportError::Other(if found.locked > 0 {
                            format!("{} locks its cookies to itself, so Athas can't read them.", source.browser.name())
                        } else {
                            format!("{} has no sign-ins saved in this profile.", source.browser.name())
                        }),
                        source,
                    },
                    Ok(found) => {
                        let selected = found.sites.iter().map(|site| site.name.clone()).collect();
                        Step::Pick { source, found, selected }
                    }
                    Err(error) => Step::Failed { source, error },
                };
                this.query.update(cx, |query, cx| query.set_text("", cx));
                this.filter(cx);
                if matches!(this.step, Step::Pick { .. }) {
                    this.query.update(cx, |query, cx| query.focus(window, cx));
                } else {
                    window.focus(&this.focus_handle, cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn filter(&mut self, cx: &mut Context<Self>) {
        let query = self.query.read(cx).text().trim().to_lowercase();
        self.visible = match &self.step {
            Step::Pick { found, .. } => found
                .sites
                .iter()
                .enumerate()
                .filter(|(_, site)| query.is_empty() || site.name.contains(&query))
                .map(|(index, _)| index)
                .collect(),
            _ => Vec::new(),
        };
        self.scroll.scroll_to_item(0, ScrollStrategy::Top);
        cx.notify();
    }

    fn toggle(&mut self, site: &str, cx: &mut Context<Self>) {
        if let Step::Pick { selected, .. } = &mut self.step
            && !selected.remove(site)
        {
            selected.insert(site.to_string());
        }
        cx.notify();
    }

    /// Selects every site the search shows, or clears them when all already are.
    fn toggle_all(&mut self, cx: &mut Context<Self>) {
        let Step::Pick { found, selected, .. } = &mut self.step else { return };
        let shown: Vec<&String> = self.visible.iter().map(|index| &found.sites[*index].name).collect();
        if shown.iter().all(|site| selected.contains(*site)) {
            for site in shown {
                selected.remove(site);
            }
        } else {
            selected.extend(shown.into_iter().cloned());
        }
        cx.notify();
    }

    fn import(&mut self, cx: &mut Context<Self>) {
        let Step::Pick { source, found, selected } = &self.step else { return };
        let cookies: Vec<import::Cookie> =
            found.sites.iter().filter(|site| selected.contains(&site.name)).flat_map(|site| site.cookies.iter().cloned()).collect();
        let sites = selected.len();
        let source = source.clone();
        self.step = Step::Importing(source.clone());
        cx.notify();
        let (sender, taken) = futures::channel::oneshot::channel();
        crate::native::import_cookies(self.host.borrow().native.as_ref(), cookies, move |count| {
            let _ = sender.send(count);
        });
        cx.spawn(async move |this, cx| {
            let taken = taken.await.unwrap_or(0);
            this.update(cx, |_, cx| {
                if taken == 0 {
                    notifications::error(cx, format!("Athas couldn't import the sign-ins from {}", source.browser.name()), None);
                } else {
                    let message = format!("Signed in to {sites} {} from {}", if sites == 1 { "site" } else { "sites" }, source.browser.name());
                    notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, message, None, None);
                    cx.emit(Imported);
                }
                cx.emit(DismissEvent);
            })
            .ok();
        })
        .detach();
    }

    fn back(&mut self, cx: &mut Context<Self>) {
        self.step = Step::Choose;
        self.visible.clear();
        cx.notify();
    }

    fn render_sites(&mut self, range: Range<usize>, _: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let Step::Pick { found, selected, .. } = &self.step else { return Vec::new() };
        range
            .filter_map(|row| {
                let site = &found.sites[*self.visible.get(row)?];
                let name = site.name.clone();
                let checked = selected.contains(&name);
                let count = site.cookies.len();
                Some(
                    div()
                        .id(("import-site", row))
                        .flex()
                        .items_center()
                        .gap(px(10.))
                        .h(px(SITE_ROW_HEIGHT))
                        .px(px(12.))
                        .cursor_pointer()
                        .hover(|style| style.bg(colors.accent))
                        .on_click(cx.listener({
                            let name = name.clone();
                            move |this, _: &ClickEvent, _, cx| this.toggle(&name, cx)
                        }))
                        .child(Checkbox::new(("import-site-check", row), checked).on_change({
                            let this = cx.weak_entity();
                            let name = name.clone();
                            move |_, _, cx| {
                                this.update(cx, |this, cx| this.toggle(&name, cx)).ok();
                            }
                        }))
                        .child(div().flex_1().min_w_0().truncate().text_color(colors.foreground).child(name))
                        .child(
                            div()
                                .flex_none()
                                .text_size(typography::text_caption())
                                .text_color(colors.subtle_foreground)
                                .child(format!("{count} {}", if count == 1 { "cookie" } else { "cookies" })),
                        )
                        .into_any_element(),
                )
            })
            .collect()
    }

    fn render_choose(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        if self.sources.is_empty() {
            return div()
                .py(px(24.))
                .child(EmptyState::new("No other browsers found").icon(IconName::Globe).message("Athas reads sign-ins from Chrome, Arc, Dia, Brave, Edge, Firefox and Safari."))
                .into_any_element();
        }
        let rows: Vec<AnyElement> = self
            .sources
            .iter()
            .enumerate()
            .map(|(index, source)| {
                let chosen = source.clone();
                div()
                    .id(("import-source", index))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(px(36.))
                    .px(px(8.))
                    .rounded(metrics::radius_md())
                    .cursor_pointer()
                    .hover(|style| style.bg(colors.accent))
                    .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| this.read(chosen.clone(), window, cx)))
                    .child(browser_mark(source.browser, cx))
                    .child(div().flex_none().font_weight(typography::MEDIUM).child(source.browser.name()))
                    .child(div().flex_none().text_color(colors.muted_foreground).child(source.profile.clone()))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_right()
                            .text_size(typography::text_caption())
                            .text_color(colors.subtle_foreground)
                            .children(source.account.clone()),
                    )
                    .child(Icon::new(IconName::ChevronRight).size(IconSize::Small).color(colors.subtle_foreground))
                    .into_any_element()
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(px(2.))
            .p(px(8.))
            .child(
                div()
                    .px(px(8.))
                    .pb(px(6.))
                    .text_color(colors.muted_foreground)
                    .child("Sites you're signed in to there stay signed in here."),
            )
            .children(rows)
            .into_any_element()
    }

    fn render_waiting(&self, label: String, note: Option<String>, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        div()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .h(px(160.))
            .px(px(24.))
            .text_center()
            .child(Spinner::new("import-waiting").label(label).show_label())
            .children(note.map(|note| div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(note)))
            .into_any_element()
    }

    fn render_pick(&self, found: &Found, selected: &HashSet<String>, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let shown = self.visible.len();
        let all_shown = shown > 0 && self.visible.iter().all(|index| selected.contains(&found.sites[*index].name));
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(12.))
                    .py(px(8.))
                    .border_b_1()
                    .border_color(colors.divider)
                    .child(div().flex_1().child(InputGroup::new(self.query.clone()).start(Icon::new(IconName::Search).size(IconSize::Small).color(colors.subtle_foreground))))
                    .child(
                        Button::new("import-toggle-all", if all_shown { "Select none" } else { "Select all" })
                            .variant(ButtonVariant::Ghost)
                            .disabled(shown == 0)
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.toggle_all(cx))),
                    ),
            )
            .child(if shown == 0 {
                div()
                    .flex()
                    .items_center()
                    .justify_center()
                    .h(px(SITE_LIST_HEIGHT))
                    .text_color(colors.muted_foreground)
                    .child("No sites match")
                    .into_any_element()
            } else {
                ui::with_scrollbar(
                    uniform_list("import-sites", shown, cx.processor(Self::render_sites)).track_scroll(&self.scroll).h(px(SITE_LIST_HEIGHT)).py(px(4.)),
                    ui::Scrollbar::uniform("import-sites-scrollbar", &self.scroll),
                )
                .into_any_element()
            })
            .when(found.locked > 0, |this| {
                this.child(
                    div()
                        .px(px(12.))
                        .py(px(8.))
                        .border_t_1()
                        .border_color(colors.divider)
                        .text_size(typography::text_caption())
                        .text_color(colors.subtle_foreground)
                        .child(format!("{} cookies are locked to the browser and stay behind.", found.locked)),
                )
            })
            .into_any_element()
    }

    fn render_failed(&self, source: &Source, error: &ImportError, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let _ = source;
        div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .p(px(16.))
            .child(Icon::new(IconName::WarningCircle).size(IconSize::Custom(px(20.))).color(colors.muted_foreground))
            .child(div().mt(px(4.)).font_weight(typography::MEDIUM).child(error.title()))
            .child(div().text_color(colors.muted_foreground).child(error.message()))
            .into_any_element()
    }
}

/// A browser's initial in a small square, where its logo would go.
fn browser_mark(browser: import::Browser, cx: &App) -> impl IntoElement {
    let theme = cx.theme();
    div()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(22.))
        .rounded(metrics::radius_md())
        .bg(theme.colors.raised)
        .shadow(theme.shadows.raised.clone())
        .text_size(typography::text_caption())
        .font_weight(typography::MEDIUM)
        .text_color(theme.colors.muted_foreground)
        .child(browser.name()[..1].to_string())
}

impl Render for ImportDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity().downgrade();
        let close = Button::new("import-cancel", "Cancel").plane(Plane::Overlay).on_click(cx.listener(|_, _: &ClickEvent, _, cx| cx.emit(DismissEvent)));
        let back = Button::new("import-back", "Back").plane(Plane::Overlay).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.back(cx)));
        let (title, body, footer): (String, AnyElement, Vec<AnyElement>) = match &self.step {
            Step::Choose => ("Import from browser".into(), self.render_choose(cx), vec![close.into_any_element()]),
            Step::Reading(source) => {
                let note = source.needs_keychain().then(|| format!("macOS may ask for your password to unlock {}.", source.browser.name()));
                (format!("Import from {}", source.browser.name()), self.render_waiting(format!("Reading {}", source.browser.name()), note, cx), vec![
                    back.into_any_element(),
                ])
            }
            Step::Importing(source) => {
                (format!("Import from {}", source.browser.name()), self.render_waiting("Importing".into(), None, cx), Vec::new())
            }
            Step::Pick { source, found, selected } => {
                let count = selected.len();
                let import = Button::new("import-confirm", if count == 0 { "Import".to_string() } else { format!("Import {count} {}", if count == 1 { "site" } else { "sites" }) })
                    .variant(ButtonVariant::Accent)
                    .disabled(count == 0)
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.import(cx)));
                (format!("Import from {}", source.browser.name()), self.render_pick(found, selected, cx), vec![
                    back.into_any_element(),
                    import.into_any_element(),
                ])
            }
            Step::Failed { source, error } => {
                let retry = source.clone();
                let mut footer = vec![back.into_any_element()];
                if matches!(error, ImportError::NeedsFullDiskAccess) {
                    footer.push(
                        Button::new("import-open-settings", "Open Settings")
                            .plane(Plane::Overlay)
                            .on_click(|_, _, cx| cx.open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"))
                            .into_any_element(),
                    );
                }
                footer.push(
                    Button::new("import-retry", "Try Again")
                        .variant(ButtonVariant::Accent)
                        .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| this.read(retry.clone(), window, cx)))
                        .into_any_element(),
                );
                (format!("Import from {}", source.browser.name()), self.render_failed(source, error, cx), footer)
            }
        };
        div().track_focus(&self.focus_handle).child(
            Dialog::new("browser-import", title)
                .icon(IconName::Download)
                .size(DialogSize::Md)
                .layout(DialogLayout::Flush)
                .scrollable(matches!(self.step, Step::Choose))
                .on_close(move |_, cx| {
                    entity.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
                })
                .footer(footer)
                .child(body),
        )
    }
}
