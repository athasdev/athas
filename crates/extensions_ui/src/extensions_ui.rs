//! The extension manager (`src/extensions/ui/components/extensions-view.tsx`): the catalog
//! by category with search, each extension's page, install, update, uninstall, enable and
//! disable with progress and errors; and the icon theme picker.

mod detail;
mod extension_dialog;
mod extension_view;
mod icon_theme_picker;
mod install_prompt;
mod tool_watch;
pub mod ui_extensions;
mod widgets;

use extensions::{CatalogEntry, CatalogSource, ExtensionKind, ExtensionStatus, Extensions, Operation};
#[cfg(not(target_family = "wasm"))]
use sandbox::Provider as _;
use ui::scale::px;
use gpui::{
    AnyElement, App, Context, EventEmitter, FocusHandle, Focusable, KeyBinding, ScrollHandle,
    SharedString, Subscription, Window, actions, div, prelude::*,
};
use theme::{ActiveTheme, ThemeColors};
use ui::{
    Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, InputAppearance, TextInput, TextInputEvent,
    WithScrollbar, metrics, typography,
};

pub use extension_dialog::ExtensionDialog;
pub use extension_view::{ExtensionView, Surface as ExtensionViewSurface};
pub use icon_theme_picker::IconThemePickerDelegate;
pub use install_prompt::prompt_for_path as prompt_install_for_path;
use widgets::{extension_icon, operation_label, progress_bar, status_badge};

actions!(extensions_ui, [Back, FocusSearch]);

/// Binds the view's keys; call once at start-up.
pub fn init(cx: &mut App) {
    ui::bind_keys_once(cx, "extensions_ui", |cx| {
        cx.bind_keys([
            KeyBinding::new("escape", Back, Some("Extensions")),
            KeyBinding::new("cmd-f", FocusSearch, Some("Extensions")),
            KeyBinding::new("ctrl-f", FocusSearch, Some("Extensions")),
        ]);
    });
    tool_watch::init(cx);
    ui_extensions::init(cx);
}

/// What the view asks of the workbench.
#[derive(Clone, Debug, PartialEq)]
pub enum ExtensionsViewEvent {
    /// The tab's title: "Integrations", or the name of the extension whose page is open.
    TitleChanged(SharedString),
    /// Open the colour theme picker, after a theme extension was installed.
    SelectTheme,
    /// Open the icon theme picker.
    SelectIconTheme,
}

/// The category filter: everything, what is installed, or one kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Filter {
    All,
    Installed,
    Kind(ExtensionKind),
}

impl Filter {
    fn from_setting(value: &str) -> Self {
        if value == "installed" {
            return Filter::Installed;
        }
        ExtensionKind::from_id(value).map_or(Filter::All, Filter::Kind)
    }

    fn setting(self) -> &'static str {
        match self {
            Filter::All => "all",
            Filter::Installed => "installed",
            Filter::Kind(kind) => kind.id(),
        }
    }

    /// Whether the catalog heads its rows by kind: one heading per kind when the filter mixes
    /// them, a single heading of its own when it does not.
    fn grouped(self) -> bool {
        !matches!(self, Filter::Kind(_))
    }

    fn admits(self, entry: &CatalogEntry, status: &ExtensionStatus) -> bool {
        match self {
            Filter::All => true,
            Filter::Installed => status.installed || status.operation.is_some(),
            Filter::Kind(kind) => entry.kind == kind,
        }
    }
}

pub struct ExtensionsView {
    focus_handle: FocusHandle,
    search: gpui::Entity<TextInput>,
    /// The extension whose page is open.
    selected: Option<String>,
    list_scroll: ScrollHandle,
    detail_scroll: ScrollHandle,
    /// Set when the view is a page of Settings: it flows in that page, which scrolls it.
    page_scroll: Option<ScrollHandle>,
    /// The catalog size the search placeholder was written for.
    placeholder_total: Option<usize>,
    /// What the keychain holds for each sandbox provider whose page has been opened, masked.
    /// `None` is "asked, and there is none"; a missing entry is "not asked yet", so `render`
    /// never has to go to the keychain itself.
    sandbox_keys: std::collections::HashMap<String, Option<SharedString>>,
    /// The provider whose key is being typed, if any.
    editing_key: Option<String>,
    key_input: gpui::Entity<TextInput>,
    /// Why the last key was refused, when it was.
    key_error: Option<SharedString>,
    /// A key is being checked against the provider right now.
    checking_key: bool,
    /// What each provider says the account has, once a key has been checked.
    sandboxes: std::collections::HashMap<String, Vec<sandbox::Listed>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ExtensionsViewEvent> for ExtensionsView {}

impl Focusable for ExtensionsView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl ExtensionsView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| {
            TextInput::new(window, cx)
                .placeholder("Search integrations")
                .appearance(InputAppearance::Field)
                .leading_icon(IconName::Search)
        });
        let subscriptions = vec![
            cx.observe_global::<ui_extensions::UiExtensions>(|_, cx| cx.notify()),
            cx.subscribe(&search, |this, input, event: &TextInputEvent, cx| match event {
                TextInputEvent::Changed(_) => {
                    this.scroll_to_top();
                    cx.notify();
                }
                TextInputEvent::Cancelled => input.update(cx, |input, cx| input.set_text("", cx)),
                _ => {}
            }),
            cx.observe_global::<Extensions>(|this, cx| {
                this.sync_search_placeholder(cx);
                cx.notify();
            }),
            cx.observe_global::<settings::SettingsStore>(|_, cx| cx.notify()),
        ];
        if *extensions::get(cx).catalog_source() == CatalogSource::Bundled {
            extensions::refresh_catalog(cx).detach();
        }
        let key_input = cx.new(|cx| {
            TextInput::new(window, cx).placeholder("Paste the API key").appearance(InputAppearance::Field).masked()
        });
        Self {
            focus_handle: cx.focus_handle(),
            search,
            key_input,
            sandbox_keys: std::collections::HashMap::new(),
            sandboxes: std::collections::HashMap::new(),
            key_error: None,
            checking_key: false,
            editing_key: None,
            selected: None,
            list_scroll: ScrollHandle::new(),
            detail_scroll: ScrollHandle::new(),
            page_scroll: None,
            placeholder_total: None,
            _subscriptions: subscriptions,
        }
    }

    /// Makes the view a page of Settings: no scroller or title of its own, the page's
    /// `scroll` scrolls it.
    pub fn embed_in_page(&mut self, scroll: ScrollHandle, cx: &mut Context<Self>) {
        self.page_scroll = Some(scroll);
        self.sync_search_placeholder(cx);
    }

    pub(crate) fn embedded(&self) -> bool {
        self.page_scroll.is_some()
    }

    /// Back to the top of whatever scrolls the view.
    pub(crate) fn scroll_to_top(&self) {
        let top = gpui::point(px(0.), px(0.));
        match &self.page_scroll {
            Some(scroll) => scroll.set_offset(top),
            None => {
                self.list_scroll.set_offset(top);
                self.detail_scroll.set_offset(top);
            }
        }
    }

    /// Opens an extension's page.
    pub fn open_extension(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(entry) = extensions::get(cx).entry(id) else { return };
        self.selected = Some(id.to_string());
        self.editing_key = None;
        self.load_sandbox_keys(&entry, cx);
        self.scroll_to_top();
        extensions::refresh_tool_status(id, cx).detach();
        cx.emit(ExtensionsViewEvent::TitleChanged(entry.manifest.display_name.clone().into()));
        cx.notify();
    }

    /// Shows one category of the catalog (`language`, `theme`, `icon-theme`, … or `all`).
    pub fn show_category(&mut self, category: &str, cx: &mut Context<Self>) {
        self.back(cx);
        let filter = Filter::from_setting(category).setting().to_string();
        settings::update(cx, |settings| settings.extensions_active_tab = filter);
        cx.notify();
    }

    /// Shows the catalog filtered by `query`.
    pub fn search_for(&mut self, query: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.back(cx);
        let query = query.to_string();
        self.search.update(cx, |input, cx| {
            input.set_text(query, cx);
            input.focus(window, cx);
        });
    }

    pub(crate) fn back(&mut self, cx: &mut Context<Self>) {
        if self.selected.take().is_some() {
            self.scroll_to_top();
            cx.emit(ExtensionsViewEvent::TitleChanged("Integrations".into()));
            cx.notify();
        }
    }

    fn on_back(&mut self, _: &Back, _: &mut Window, cx: &mut Context<Self>) {
        // Escape leaves an extension's page. With the catalog open there is nothing to leave,
        // so it belongs to whatever holds the view — the Settings dialog closes on it.
        if self.selected.is_none() {
            cx.propagate();
            return;
        }
        self.back(cx);
    }

    fn on_focus_search(&mut self, _: &FocusSearch, window: &mut Window, cx: &mut Context<Self>) {
        self.back(cx);
        self.search.update(cx, |input, cx| input.focus(window, cx));
    }

    /// Asks the keychain for this extension's provider keys, off the main thread: a keychain can
    /// take a moment, and on Linux it can be a prompt. `render` only ever reads the answer.
    fn load_sandbox_keys(&mut self, entry: &CatalogEntry, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        {
            let providers: Vec<String> = entry
                .manifest
                .sandbox_providers()
                .map(|provider| provider.id.clone())
                .filter(|id| !self.sandbox_keys.contains_key(id))
                .collect();
            if providers.is_empty() {
                return;
            }
            cx.spawn(async move |this, cx| {
                let read = cx
                    .background_spawn(async move {
                        providers
                            .into_iter()
                            .map(|id| {
                                let masked = sandbox::keys::get(&id).map(|key| SharedString::from(sandbox::keys::mask(&key)));
                                (id, masked)
                            })
                            .collect::<Vec<_>>()
                    })
                    .await;
                this.update(cx, |this, cx| {
                    let with_keys: Vec<String> =
                        read.iter().filter(|(_, masked)| masked.is_some()).map(|(id, _)| id.clone()).collect();
                    this.sandbox_keys.extend(read);
                    for provider in with_keys {
                        this.refresh_sandboxes(&provider, cx);
                    }
                    cx.notify();
                })
                .ok();
            })
            .detach();
        }
        #[cfg(target_family = "wasm")]
        let _ = entry;
    }

    /// What is known about `provider`'s key: `None` while it is still being read.
    pub(crate) fn sandbox_key(&self, provider: &str) -> Option<Option<SharedString>> {
        self.sandbox_keys.get(provider).cloned()
    }

    pub(crate) fn editing_key(&self) -> Option<&str> {
        self.editing_key.as_deref()
    }

    pub(crate) fn key_field(&self) -> gpui::Entity<TextInput> {
        self.key_input.clone()
    }

    pub(crate) fn start_key_entry(&mut self, provider: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.editing_key = Some(provider.to_string());
        self.key_error = None;
        self.key_input.update(cx, |input, cx| {
            input.set_text("", cx);
            input.focus(window, cx);
        });
        cx.notify();
    }

    pub(crate) fn cancel_key_entry(&mut self, cx: &mut Context<Self>) {
        self.editing_key = None;
        cx.notify();
    }

    /// Checks what was typed against the provider before keeping it: a key is only worth storing
    /// if it works, and the cheapest question that needs one is "what do I have?". An empty field
    /// is a cancel, not a key.
    pub(crate) fn save_key(&mut self, cx: &mut Context<Self>) {
        let Some(provider) = self.editing_key.clone() else { return };
        let key = self.key_input.read(cx).text().trim().to_string();
        if key.is_empty() {
            self.editing_key = None;
            cx.notify();
            return;
        }
        self.key_error = None;
        self.checking_key = true;
        cx.notify();
        #[cfg(not(target_family = "wasm"))]
        cx.spawn(async move |this, cx| {
            let asked = {
                let provider = provider.clone();
                let key = key.clone();
                cx.background_spawn(async move { client_for(&provider, &key).map(|client| client.list()) }).await
            };
            this.update(cx, |this, cx| {
                this.checking_key = false;
                match asked {
                    // The provider answered: the key works, so it is worth keeping.
                    Some(Ok(listed)) => {
                        this.keep_key(&provider, &key, cx);
                        this.sandboxes.insert(provider.clone(), listed);
                    }
                    // Refused. Keeping it would only hide the problem until the first command.
                    Some(Err(error)) if error.kind == sandbox::ErrorKind::Auth => {
                        this.key_error = Some(error.message.into());
                    }
                    // Could not be checked -- offline, or the provider is down. The key may well
                    // be right, so it is kept, and the page says it is unchecked rather than good.
                    Some(Err(error)) => {
                        this.keep_key(&provider, &key, cx);
                        this.key_error = Some(format!("Saved, but it could not be checked. {}", error.message).into());
                    }
                    None => this.key_error = Some("Athas has no client for this provider.".into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        self.key_input.update(cx, |input, cx| input.set_text("", cx));
    }

    /// Puts a key in the keychain and shows it as saved.
    #[cfg(not(target_family = "wasm"))]
    fn keep_key(&mut self, provider: &str, key: &str, _cx: &mut Context<Self>) {
        match sandbox::keys::store(provider, key) {
            Ok(()) => {
                self.sandbox_keys.insert(provider.to_string(), Some(SharedString::from(sandbox::keys::mask(key))));
                self.editing_key = None;
            }
            Err(error) => {
                log::error!("The sandbox key could not be saved: {error}");
                self.key_error = Some("This computer's keychain would not keep the key.".into());
            }
        }
    }

    pub(crate) fn key_error(&self) -> Option<SharedString> {
        self.key_error.clone()
    }

    pub(crate) fn checking_key(&self) -> bool {
        self.checking_key
    }

    pub(crate) fn provider_sandboxes(&self, provider: &str) -> Option<&[sandbox::Listed]> {
        self.sandboxes.get(provider).map(Vec::as_slice)
    }

    /// Asks the provider what the account has. Called when a page with a saved key opens, and
    /// after a sandbox is stopped.
    pub(crate) fn refresh_sandboxes(&mut self, provider: &str, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        {
            let provider = provider.to_string();
            cx.spawn(async move |this, cx| {
                let listed = {
                    let provider = provider.clone();
                    cx.background_spawn(async move {
                        let key = sandbox::keys::get(&provider)?;
                        client_for(&provider, &key)?.list().ok()
                    })
                    .await
                };
                this.update(cx, |this, cx| {
                    if let Some(listed) = listed {
                        this.sandboxes.insert(provider, listed);
                        cx.notify();
                    }
                })
                .ok();
            })
            .detach();
        }
        #[cfg(target_family = "wasm")]
        let _ = provider;
    }

    /// Stops one sandbox, then asks again rather than guessing what the list became.
    pub(crate) fn stop_sandbox(&mut self, provider: &str, id: &str, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        {
            let (provider, id) = (provider.to_string(), id.to_string());
            cx.spawn(async move |this, cx| {
                {
                    let (provider, id) = (provider.clone(), id.clone());
                    cx.background_spawn(async move {
                        let Some(key) = sandbox::keys::get(&provider) else { return };
                        let Some(client) = client_for(&provider, &key) else { return };
                        let listed = sandbox::Listed { id, ..Default::default() };
                        if let Err(error) = client.dispose(&listed.handle(&provider)) {
                            log::error!("The sandbox could not be stopped: {error}");
                        }
                    })
                    .await;
                }
                this.update(cx, |this, cx| this.refresh_sandboxes(&provider, cx)).ok();
            })
            .detach();
        }
        #[cfg(target_family = "wasm")]
        let _ = (provider, id);
    }

    pub(crate) fn remove_key(&mut self, provider: &str, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        if let Err(error) = sandbox::keys::clear(provider) {
            log::error!("The sandbox key could not be removed: {error}");
        }
        self.sandbox_keys.insert(provider.to_string(), None);
        self.editing_key = None;
        cx.notify();
    }

    fn filter(&self, cx: &App) -> Filter {
        Filter::from_setting(&settings::get(cx).extensions_active_tab)
    }

    fn set_filter(&mut self, filter: Filter, cx: &mut Context<Self>) {
        let value = filter.setting().to_string();
        settings::update(cx, |settings| settings.extensions_active_tab = value);
        self.scroll_to_top();
        cx.notify();
    }

    pub(crate) fn install(&mut self, id: &str, cx: &mut Context<Self>) {
        let task = extensions::install(id, cx);
        let theme_extension = extensions::get(cx).entry(id).is_some_and(|entry| entry.kind == ExtensionKind::Theme);
        cx.spawn(async move |this, cx| {
            if task.await.is_ok() && theme_extension {
                this.update(cx, |_, cx| cx.emit(ExtensionsViewEvent::SelectTheme)).ok();
            }
        })
        .detach();
    }

    pub(crate) fn uninstall(&mut self, id: &str, cx: &mut Context<Self>) {
        extensions::uninstall(id, cx).detach();
    }

    pub(crate) fn set_enabled(&mut self, id: &str, enabled: bool, cx: &mut Context<Self>) {
        if let Err(error) = extensions::set_enabled(id, enabled, cx) {
            eprintln!("extensions: {error:#}");
        }
    }

    /// Switches to a colour theme an extension contributed.
    pub(crate) fn use_theme(&mut self, theme_id: &str, cx: &mut Context<Self>) {
        let Some(theme) = theme::registry(cx).get(theme_id) else { return };
        let id = theme_id.to_string();
        settings::update(cx, |settings| {
            settings.theme = id;
            settings.sync_system_theme = false;
        });
        theme::activate(theme, cx);
        cx.refresh_windows();
    }

    fn visible_entries(&self, cx: &App) -> Vec<(CatalogEntry, ExtensionStatus)> {
        let query = self.search.read(cx).text().trim().to_lowercase();
        let filter = self.filter(cx);
        let extensions = extensions::get(cx);
        let settings = settings::get(cx);
        let mut entries: Vec<(CatalogEntry, ExtensionStatus)> = extensions
            .entries()
            .into_iter()
            .filter(|entry| query.is_empty() || matches_query(entry, &query))
            .map(|entry| {
                let status = extensions.status(&entry.manifest.id, settings);
                (entry, status)
            })
            .filter(|(entry, status)| filter.admits(entry, status))
            .collect();
        entries.sort_by(|(a, _), (b, _)| {
            (a.kind, a.manifest.display_name.to_lowercase()).cmp(&(b.kind, b.manifest.display_name.to_lowercase()))
        });
        entries
    }

    /// How many integrations the catalog could show, and how many it does.
    fn counts(&self, visible: usize, cx: &App) -> String {
        let extensions = extensions::get(cx);
        let total = extensions.entries().len();
        let narrowed = visible != total;
        let mut detail = if narrowed {
            format!("{visible} of {total} integrations")
        } else {
            format!("{total} integration{}", if total == 1 { "" } else { "s" })
        };
        let installed = extensions.installed_count();
        if installed > 0 {
            detail.push_str(&format!(" · {installed} installed"));
        }
        detail
    }

    /// The bar Settings pins above the page: the categories, the updates button and the search
    /// on one line, so the catalog scrolls under a toolbar that stays put. `None` while an
    /// extension's own page is open, which has a breadcrumb of its own instead.
    pub fn page_toolbar(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !self.embedded() || self.selected.is_some() {
            return None;
        }
        let extensions = extensions::get(cx);
        let settings = settings::get(cx);
        let updates = extensions
            .entries()
            .iter()
            .filter(|entry| extensions.status(&entry.manifest.id, settings).update_available)
            .count();
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .w_full()
                .min_w_0()
                // Settings floats its close button over the top right corner of the page.
                .pr(px(32.))
                .child(div().flex().flex_1().min_w_0().child(self.render_filters(cx)))
                .when(updates > 0, |this| {
                    this.child(
                        Button::new("extensions-update-all", format!("Update {updates}"))
                            .leading_icon(IconName::Download)
                            .size(ButtonSize::Small)
                            .variant(ButtonVariant::Accent)
                            .on_click(cx.listener(|_, _, _, cx| extensions::update_all(cx).detach())),
                    )
                })
                .child(div().flex_none().w(px(196.)).child(self.search.clone()))
                .into_any_element(),
        )
    }

    /// How many integrations the search looks through, in its placeholder: the count used to
    /// have a line of its own over the catalog, which is the line the toolbar took.
    fn sync_search_placeholder(&mut self, cx: &mut Context<Self>) {
        if !self.embedded() {
            return;
        }
        let total = extensions::get(cx).entries().len();
        if self.placeholder_total == Some(total) {
            return;
        }
        self.placeholder_total = Some(total);
        let placeholder = match total {
            0 => "Search integrations...".to_string(),
            total => format!("Search {total} integrations..."),
        };
        self.search.update(cx, |input, cx| input.set_placeholder(placeholder, cx));
    }

    /// The page's header (`WorkbenchContent`): "Integrations" over the count, the search at the
    /// end. On its own; as a page of Settings the toolbar carries the search instead.
    fn render_header(&self, visible: usize, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let extensions = extensions::get(cx);
        let settings = settings::get(cx);
        let updates = extensions
            .entries()
            .iter()
            .filter(|entry| extensions.status(&entry.manifest.id, settings).update_available)
            .count();
        let mut detail = self.counts(visible, cx);
        if updates > 0 {
            detail.push_str(&format!(" · {updates} update{}", if updates == 1 { "" } else { "s" }));
        }
        let embedded = self.embedded();
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(16.))
            .mb(if embedded { px(12.) } else { px(26.) })
            // Settings floats its close button over the top right corner of the page.
            .when(embedded, |this| this.pr(px(32.)))
            .min_w_0()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w(px(224.))
                    .when(!embedded, |this| {
                        this.child(
                            div()
                                .text_size(typography::text_lg())
                                .line_height(px(21.))
                                .font_weight(typography::MEDIUM)
                                .text_color(colors.foreground)
                                .child("Integrations"),
                        )
                    })
                    .child(
                        div()
                            .when(!embedded, |this| this.mt(px(2.)))
                            .text_size(typography::text_sm())
                            .line_height(px(20.))
                            .text_color(colors.subtle_foreground)
                            .child(detail),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                        .children(self.render_installed_toggle(cx))
                    .when(updates > 0, |this| {
                        this.child(
                            Button::new("extensions-update-all", "Update All")
                                .leading_icon(IconName::Download)
                                .size(ButtonSize::Small)
                                .variant(ButtonVariant::Accent)
                                .on_click(cx.listener(|_, _, _, cx| extensions::update_all(cx).detach())),
                        )
                    })
                    .child(div().w(px(196.)).child(self.search.clone())),
            )
    }

        /// "Installed" is not a category -- a theme stays a theme once it is installed -- so it is a
        /// switch among the header's controls rather than a tab among the kinds. It turns off by
        /// going back to "All", which is the filter it replaced.
        fn render_installed_toggle(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
            if extensions::get(cx).installed_count() == 0 {
                return None;
            }
            let showing_installed = self.filter(cx) == Filter::Installed;
            Some(
                Button::new("extensions-installed-filter", "Installed")
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Ghost)
                    .filled_when_active()
                    .active(showing_installed)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.set_filter(if showing_installed { Filter::All } else { Filter::Installed }, cx);
                    })),
            )
        }

        /// The category tabs: a segmented control, labels only, one per kind the catalog holds.
    fn render_filters(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let active = self.filter(cx);
        let extensions = extensions::get(cx);
        let entries = extensions.entries();
        let mut triggers = vec![ui::TabsTrigger::new(Filter::All.setting(), "All")];
        for kind in ExtensionKind::ALL {
            if entries.iter().any(|entry| entry.kind == kind) {
                triggers.push(ui::TabsTrigger::new(Filter::Kind(kind).setting(), kind.label()));
            }
        }
        let view = cx.entity().downgrade();
        div().id("extensions-filters").flex().when(!self.embedded(), |this| this.flex_none().mb(px(16.))).min_w_0().child(
            ui::Tabs::new("extensions-filter-tabs", triggers, active.setting()).wrap().on_change(move |value, _, cx| {
                let filter = Filter::from_setting(value);
                view.update(cx, |this, cx| this.set_filter(filter, cx)).ok();
            }),
        )
    }

    fn render_catalog_notice(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let CatalogSource::Failed(error) = extensions::get(cx).catalog_source().clone() else { return None };
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .mb(px(12.))
                .px(px(10.))
                .py(px(6.))
                .rounded(metrics::radius_md())
                .bg(colors.warning_soft)
                .text_size(typography::text_sm())
                .child(Icon::new(IconName::CloudWarning).size(IconSize::Small).color(colors.warning))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_color(colors.foreground)
                        .child(format!("Marketplace integrations could not load, showing the built-in ones. {error}")),
                )
                .child(
                    Button::new("extensions-retry", "Retry")
                        .size(ButtonSize::Small)
                        .variant(ButtonVariant::Ghost)
                        .on_click(cx.listener(|_, _, _, cx| extensions::refresh_catalog(cx).detach())),
                )
                .into_any_element(),
        )
    }

    /// One catalog row (`ExtensionCatalogCard`): the icon tile, name and description, and the
    /// state at the end. An extension that is not installed yet carries its own Install, so the
    /// catalog installs in place; the row still opens the extension's page.
    fn render_row(&self, entry: &CatalogEntry, status: &ExtensionStatus, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let id = entry.manifest.id.clone();
        let manifest = &entry.manifest;
        let state: Option<AnyElement> = match status.operation {
            Some(operation) => Some(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .text_size(typography::text_caption())
                    .text_color(colors.muted_foreground)
                    .child(operation_label(operation))
                    .child(progress_bar(
                        match operation {
                            Operation::Installing(fraction) => fraction,
                            Operation::Uninstalling => 1.,
                        },
                        px(56.),
                        colors,
                    ))
                    .into_any_element(),
            ),
            None if status.installed && status.error.is_none() && has_tool_issue(&id, cx) => {
                Some(widgets::badge("Issue", widgets::Tone::Danger, colors).into_any_element())
            }
            None if !status.installed && !status.blocked => {
                let install_id = id.clone();
                // One Install on every row of a 90-row catalog is noise, so it waits for the
                // row to be hovered; it keeps its place either way.
                Some(
                    div()
                        .invisible()
                        .group_hover(ROW_GROUP, |style| style.visible())
                        .child(
                            Button::new(SharedString::from(format!("extension-install-{id}")), "Install")
                                .size(ButtonSize::Small)
                                .variant(ButtonVariant::Ghost)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    // The row opens the extension's page; its button only installs.
                                    cx.stop_propagation();
                                    this.install(&install_id, cx);
                                })),
                        )
                        .into_any_element(),
                )
            }
            None => status_badge(status, colors),
        };
        let open_id = id.clone();
        let view = cx.entity().downgrade();
        let mut item = ui::Item::new(SharedString::from(format!("extension-{id}")))
            .variant(ui::ItemVariant::Raised)
            .hover_group(ROW_GROUP)
            .media(ui::ItemMedia::Element(extension_icon(entry, px(32.), colors)))
            .title(manifest.display_name.clone())
            .on_click(move |_, _, cx| {
                view.update(cx, |this, cx| this.open_extension(&open_id, cx)).ok();
            });
        if let Some(state) = state {
            item = item.action(state);
        }
        item.into_any_element()
    }

    fn render_catalog(&self, entries: &[(CatalogEntry, ExtensionStatus)], colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        if entries.is_empty() {
            let searching = !self.search.read(cx).text().trim().is_empty();
            return div()
                .flex()
                .min_h(px(256.))
                .items_center()
                .justify_center()
                .child(
                    EmptyState::new("No integrations found").icon(IconName::Package).when(searching, |state| {
                        state.action(
                            Button::new("extensions-clear-search", "Clear search")
                                .size(ButtonSize::Small)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.search.update(cx, |input, cx| input.set_text("", cx));
                                })),
                        )
                    }),
                )
                .into_any_element();
        }
        // "All" with an empty search is the way in, not a list of ninety: a few of every kind in
        // the order the kinds matter, and a way into each one's own list. Anything narrower --
        // a kind, Installed, a search -- is already a list, and shows all of what it found.
        if self.filter(cx) == Filter::All && self.search.read(cx).text().trim().is_empty() {
            return self.render_landing(entries, colors, cx);
        }
        let grouped = self.filter(cx).grouped();
        let mut sections: Vec<AnyElement> = Vec::new();
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut current_kind: Option<ExtensionKind> = None;
        for (entry, status) in entries {
            if grouped
                && let Some(kind) = current_kind.filter(|kind| *kind != entry.kind)
            {
                sections.push(self.section(kind.label(), std::mem::take(&mut rows), None));
            }
            current_kind = Some(entry.kind);
            rows.push(self.render_row(entry, status, colors, cx));
        }
        if let Some(kind) = current_kind {
            let title = if grouped { kind.label() } else { self.filter_label(cx) };
            sections.push(self.section(title, rows, None));
        }
        div().flex().flex_col().gap(px(24.)).children(sections).into_any_element()
    }

    /// The first page: every kind that has anything, cut to [`LANDING_PER_KIND`], each with the
    /// way into its own list when there is more behind it.
    fn render_landing(&self, entries: &[(CatalogEntry, ExtensionStatus)], colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let mut sections: Vec<AnyElement> = Vec::new();
        for kind in ExtensionKind::ALL {
            let of_kind: Vec<&(CatalogEntry, ExtensionStatus)> = entries.iter().filter(|(entry, _)| entry.kind == kind).collect();
            if of_kind.is_empty() {
                continue;
            }
            let rows = of_kind.iter().take(LANDING_PER_KIND).map(|(entry, status)| self.render_row(entry, status, colors, cx)).collect();
            let more = (of_kind.len() > LANDING_PER_KIND).then(|| {
                let view = cx.entity().downgrade();
                Button::new(SharedString::from(format!("extensions-show-all-{}", kind.id())), format!("All {}", of_kind.len()))
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Ghost)
                    .trailing_icon(IconName::ArrowRight)
                    .on_click(move |_, _, cx| {
                        view.update(cx, |this, cx| this.set_filter(Filter::Kind(kind), cx)).ok();
                    })
                    .into_any_element()
            });
            sections.push(self.section(kind.label(), rows, more));
        }
        div().flex().flex_col().gap(px(24.)).children(sections).into_any_element()
    }

    /// A headed section of the catalog, its rows laid out two to a line.
    fn section(&self, title: &'static str, rows: Vec<AnyElement>, action: Option<AnyElement>) -> AnyElement {
        let mut section = ui::GroupedSection::new(title).variant(ui::GroupedSectionVariant::Bare);
        if let Some(action) = action {
            section = section.action(action);
        }
        section.child(self.grid(rows)).into_any_element()
    }

    /// The column the page is read in: the header and the catalog under it share it, or the
    /// categories would sit over a list that starts somewhere else.
    fn page_width(&self, element: gpui::Div) -> gpui::Div {
        element.flex().flex_col().w_full().max_w(px(768.)).mx_auto().px(px(24.))
    }

    /// Rows of two. Ninety integrations one above the other is a long scroll past things that
    /// would have fitted side by side; as a page of Settings there is no room for two, so there
    /// it stays one.
    fn grid(&self, cells: Vec<AnyElement>) -> AnyElement {
        let columns = if self.embedded() { 1 } else { 2 };
        let mut cells = cells.into_iter().peekable();
        let mut lines: Vec<AnyElement> = Vec::new();
        while cells.peek().is_some() {
            let line: Vec<AnyElement> = cells.by_ref().take(columns).collect();
            // The last line keeps the grid's columns, so one odd row does not stretch across it.
            let empty = columns - line.len();
            lines.push(
                div()
                    .flex()
                    .gap(px(8.))
                    .children(line.into_iter().map(|cell| div().flex_1().min_w_0().child(cell)))
                    .children((0..empty).map(|_| div().flex_1()))
                    .into_any_element(),
            );
        }
        div().flex().flex_col().gap(px(8.)).children(lines).into_any_element()
    }

    fn filter_label(&self, cx: &App) -> &'static str {
        match self.filter(cx) {
            Filter::All => "All",
            Filter::Installed => "Installed",
            Filter::Kind(kind) => kind.label(),
        }
    }
}

/// The client for a provider Athas speaks to, by the id its manifest declares. A provider in a
/// manifest this build has no client for is nothing Athas can do anything with.
#[cfg(not(target_family = "wasm"))]
fn client_for(provider: &str, key: &str) -> Option<impl sandbox::Provider> {
    (provider == sandbox::e2b::ID).then(|| sandbox::e2b::E2b::new(key))
}

/// The hover group of a catalog row, so its Install shows only under the pointer.
const ROW_GROUP: &str = "extension-row";

/// How many of a kind the first page shows before it sends the reader to that kind's own list.
const LANDING_PER_KIND: usize = 4;

fn has_tool_issue(id: &str, cx: &App) -> bool {
    extensions::get(cx).tool_statuses(id).is_some_and(|statuses| statuses.issue().is_some())
}

fn matches_query(entry: &CatalogEntry, query: &str) -> bool {
    let manifest = &entry.manifest;
    let contains = |text: &str| text.to_lowercase().contains(query);
    contains(&manifest.display_name)
        || contains(&manifest.description)
        || contains(&manifest.publisher)
        || contains(&manifest.id)
        || contains(entry.kind.label())
        || manifest.languages().any(|language| contains(&language.id) || language.extensions.iter().any(|ext| contains(ext)))
        || manifest.mcp_servers().any(|server| contains(&server.id))
}

impl Render for ExtensionsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let body = match self.selected.clone().and_then(|id| extensions::get(cx).entry(&id)) {
            Some(entry) => detail::render(self, &entry, &colors, cx),
            None => {
                let entries = self.visible_entries(cx);
                let embedded = self.embedded();
                // Embedded, the header's count sits in the search placeholder and its categories
                // in the toolbar Settings pins above the page, which also scrolls the catalog.
                if embedded {
                    div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .children(self.render_catalog_notice(&colors, cx))
                        .child(self.render_catalog(&entries, &colors, cx))
                        .into_any_element()
                } else {
                    // The title, the count and the categories stay put; only the catalog moves under
                    // them. Scrolled, the catalog fades out behind the header the way every other
                    // clipped list in Athas does, so the row cut off at the top says it is cut off.
                    let header = self
                        .page_width(div().pt(px(20.)))
                        .children(self.render_catalog_notice(&colors, cx))
                        .child(self.render_header(entries.len(), &colors, cx))
                        .child(self.render_filters(cx));
                    let catalog = div()
                        .id("extensions-list")
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .child(self.page_width(div().pb(px(20.))).child(self.render_catalog(&entries, &colors, cx)))
                        .scrollbar_with(&self.list_scroll);
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_h_0()
                        .child(div().flex_none().w_full().child(header))
                        .child(ui::faded_scroll(catalog, &self.list_scroll, colors.background).flex_1().min_h_0())
                        .into_any_element()
                }
            }
        };
        div()
            .key_context("Extensions")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::on_back))
            .on_action(cx.listener(Self::on_focus_search))
            .flex()
            .flex_col()
            // Embedded it is one block of a Settings page, which gives it its width and ground.
            // It must keep its full height there: a block that may shrink (`min_h_0`, the
            // default `flex-shrink`) is squeezed into the page instead of scrolling it.
            // On its own it is a centre tab beside the editors, so it stands on the same ground
            // they do. `surface` is the chrome's colour and left a seam down the tab strip.
            .when(!self.embedded(), |this| this.min_h_0().size_full().bg(colors.background))
            .when(self.embedded(), |this| this.w_full().flex_none())
            .text_color(colors.foreground)
            .font_family(typography::ui_font())
            .child(body)
    }
}
