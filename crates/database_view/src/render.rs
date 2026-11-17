//! How the database view draws, after `sql-database-viewer.tsx`: one object at a time under a
//! breadcrumb toolbar with Data / Schema / Info, the objects column, the search or SQL bar, the
//! grid and its pagination, and the dialogs over them. Without a connection it lists the saved
//! connections (the original keeps those in the command palette's database page).

use gpui::{
    AnyElement, Anchor, App, ClickEvent, Context, Entity, Hsla, IntoElement, MouseButton, MouseDownEvent, SharedString, Window,
    div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{
    Button, ButtonSize, ButtonTone, ButtonVariant, EmptyState, Icon, IconName, IconSize, MenuEntry, MenuItem, OpenMenu,
    PathBreadcrumb, SidebarListItem, Tabs, TabsTrigger, WithScrollbar, metrics, typography,
};

use crate::{
    ConnectionState, DatabaseView, DbTab, Dialog, PAGE_SIZES, TabBody, TableMode, TableTab,
    format,
    model::{FilterOp, ObjectKind, Provider},
    sql_editor::SqlEditor,
};

/// `SidebarPanel className="w-64"`.
const SIDEBAR_WIDTH: f32 = 256.;
/// `PaneContentHeader`.
const TOOLBAR_HEIGHT: f32 = 40.;

impl DatabaseView {
    pub(crate) fn show_menu(&mut self, key: &str, entries: Vec<MenuEntry>, window: &mut Window, cx: &mut Context<Self>) {
        if self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == key) {
            self.open_menu = None;
            cx.notify();
            return;
        }
        let position = window.mouse_position();
        self.open_menu = Some(OpenMenu::new(key.to_string(), entries, position, Anchor::TopLeft, window, cx, |this: &mut Self, _| {
            this.open_menu = None
        }));
        cx.notify();
    }

    /// A menu item that calls back into the view.
    pub(crate) fn item(
        &self,
        label: impl Into<SharedString>,
        cx: &mut Context<Self>,
        action: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> MenuItem {
        let view = cx.entity().downgrade();
        MenuItem::new(label).on_select(move |window, cx| {
            view.update(cx, |this, cx| action(this, window, cx)).ok();
        })
    }

    pub(crate) fn listener_click(
        cx: &mut Context<Self>,
        action: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
        cx.listener(move |this, _: &ClickEvent, window, cx| action(this, window, cx))
    }

    // The left column.

    fn render_sidebar(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        div()
            .id("database-sidebar")
            .flex()
            .flex_col()
            .flex_none()
            .w(px(SIDEBAR_WIDTH))
            .h_full()
            .border_r_1()
            .border_color(colors.divider)
            .child(
                div()
                    .id("database-sidebar-scroll")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(px(6.))
                    .pb(px(8.))
                    .when(self.state == ConnectionState::Connected, |this| {
                        if self.mongo.is_some() {
                            this.child(self.render_mongo_collections(cx))
                        } else if self.redis.is_some() {
                            this.child(self.render_redis_keys(cx))
                        } else {
                            this.child(self.render_objects(cx))
                        }
                    })
                    .when(!self.history.is_empty(), |this| this.child(self.render_history(cx)))
                    .scrollbar(window, cx),
            )
    }

    pub(crate) fn section_title(label: impl Into<SharedString>, trailing: impl IntoElement, cx: &App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_none()
            .items_center()
            .h(px(32.))
            .pl(px(6.))
            .mt(px(4.))
            .gap(px(2.))
            .text_size(typography::TEXT_SM)
            .font_weight(typography::MEDIUM)
            .text_color(colors.muted_foreground)
            .child(div().flex_1().min_w_0().truncate().child(label.into()))
            .child(trailing)
    }

    fn render_connections(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let current = self.connection.clone();
        let unsaved = current.as_ref().filter(|connection| !self.saved.iter().any(|saved| saved.id == connection.id)).cloned();
        let add = Button::icon("add-connection", IconName::Plus)
            .size(ButtonSize::Small)
            .tooltip("Add connection")
            .on_click(cx.listener(|this, _, window, cx| {
                let entries = vec![
                    this.item("New connection…", cx, |this, window, cx| this.show_connection_form(None, window, cx))
                        .icon(IconName::PlugsConnected)
                        .into(),
                    this.item("Open database file…", cx, |this, window, cx| this.open_database_file(window, cx))
                        .icon(IconName::FolderOpen)
                        .into(),
                ];
                this.show_menu("add-connection", entries, window, cx);
            }));

        let status_dot = |connected: bool, failed: bool| {
            let color: Hsla = if failed {
                colors.destructive
            } else if connected {
                colors.success
            } else {
                colors.subtle_foreground.opacity(0.5)
            };
            div().size(px(6.)).rounded_full().bg(color)
        };

        let mut rows: Vec<AnyElement> = Vec::new();
        if let Some(connection) = unsaved {
            let active_state = &self.state;
            rows.push(
                SidebarListItem::new("unsaved-connection", connection.name.clone())
                    .in_content()
                    .active(true)
                    .leading(Icon::new(IconName::Database).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .description(connection.location())
                    .trailing(status_dot(*active_state == ConnectionState::Connected, matches!(active_state, ConnectionState::Failed(_))))
                    .hover_trailing(
                        Button::icon("remember-connection", IconName::Pin)
                            .size(ButtonSize::XSmall)
                            .tooltip("Save connection")
                            .on_click(cx.listener(|this, _, _, cx| this.remember_connection(cx))),
                    )
                    .into_any_element(),
            );
        }
        for (ix, saved) in self.saved.iter().enumerate() {
            let active = current.as_ref().is_some_and(|connection| connection.id == saved.id);
            let connection = saved.clone();
            let edit = saved.clone();
            let id = saved.id.clone();
            let menu_connection = saved.clone();
            rows.push(
                SidebarListItem::new(("connection", ix), saved.name.clone())
                    .in_content()
                    .active(active)
                    .leading(Icon::new(provider_icon(saved.provider)).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .description(format!("{} · {}", saved.provider.label(), saved.location()))
                    .when(active, |this| {
                        this.trailing(status_dot(
                            self.state == ConnectionState::Connected,
                            matches!(self.state, ConnectionState::Failed(_)),
                        ))
                    })
                    .hover_trailing(
                        div()
                            .flex()
                            .gap(px(2.))
                            .child(
                                Button::icon(("edit-connection", ix), IconName::Pencil)
                                    .size(ButtonSize::XSmall)
                                    .tooltip("Edit")
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        cx.stop_propagation();
                                        this.show_connection_form(Some(edit.clone()), window, cx)
                                    })),
                            )
                            .child(
                                Button::icon(("remove-connection", ix), IconName::Trash)
                                    .size(ButtonSize::XSmall)
                                    .tooltip("Remove")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        cx.stop_propagation();
                                        this.request_forget(&id, cx)
                                    })),
                            ),
                    )
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let same = this.connection.as_ref().is_some_and(|current| current.id == connection.id);
                        if !same || matches!(this.state, ConnectionState::Failed(_)) {
                            this.connect(connection.clone(), None, window, cx);
                        }
                    }))
                    .on_secondary_mouse_down(cx.listener(move |this, _: &MouseDownEvent, window, cx| {
                        let connect = menu_connection.clone();
                        let edit = menu_connection.clone();
                        let id = menu_connection.id.clone();
                        let entries = vec![
                            this.item("Connect", cx, move |this, window, cx| this.connect(connect.clone(), None, window, cx))
                                .icon(IconName::PlugsConnected)
                                .into(),
                            this.item("Edit…", cx, move |this, window, cx| this.show_connection_form(Some(edit.clone()), window, cx))
                                .icon(IconName::Pencil)
                                .into(),
                            MenuEntry::Separator,
                            this.item("Remove", cx, move |this, _, cx| this.request_forget(&id, cx))
                                .icon(IconName::Trash)
                                .destructive()
                                .into(),
                        ];
                        this.show_menu("connection-menu", entries, window, cx);
                    }))
                    .into_any_element(),
            );
        }

        div()
            .flex()
            .flex_col()
            .child(Self::section_title("Connections", add, cx))
            .children(rows)
            .when(self.saved.is_empty() && self.connection.is_none(), |this| {
                this.child(
                    div()
                        .px(px(6.))
                        .py(px(4.))
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.subtle_foreground)
                        .child("No saved connections"),
                )
            })
    }

    /// `TableSidebar`: "Objects (n)" with Create table, then each kind under its label.
    fn render_objects(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let listed: Vec<_> = self.objects.iter().filter(|object| object.kind != ObjectKind::Index).cloned().collect();
        let postgres = self.backend.as_ref().is_some_and(|backend| backend.provider() == Provider::Postgres);
        let actions = div()
            .flex()
            .gap(px(2.))
            .child(
                Button::icon("refresh-objects", IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .tooltip("Refresh")
                    .on_click(cx.listener(|this, _, _, cx| this.refresh_objects(cx))),
            )
            .child(
                Button::icon("create-object", IconName::Plus)
                    .size(ButtonSize::Small)
                    .tooltip(if postgres { "Create table or subscription" } else { "Create table" })
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if !postgres {
                            this.show_create_table(window, cx);
                            return;
                        }
                        let entries = vec![
                            this.item("New table…", cx, |this, window, cx| this.show_create_table(window, cx)).icon(IconName::Table).into(),
                            this.item("New subscription…", cx, |this, window, cx| this.show_create_subscription(window, cx))
                                .icon(IconName::Broadcast)
                                .into(),
                        ];
                        this.show_menu("create-object", entries, window, cx);
                    })),
            );

        let selected = self.object_tab().and_then(DbTab::object_name).map(str::to_string);
        let mut groups: Vec<AnyElement> = Vec::new();
        for kind in ObjectKind::ORDER {
            let objects: Vec<_> = listed.iter().filter(|object| object.kind == kind).cloned().collect();
            if objects.is_empty() {
                continue;
            }
            groups.push(
                div()
                    .flex()
                    .items_center()
                    .h(px(28.))
                    .px(px(6.))
                    .when(!groups.is_empty(), |this| this.mt(px(6.)))
                    .text_size(typography::TEXT_SM)
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .child(kind.group_label())
                    .into_any_element(),
            );
            for object in objects {
                let name = object.name.clone();
                let menu_name = object.name.clone();
                let icon = match kind {
                    ObjectKind::Table => IconName::Table,
                    ObjectKind::View | ObjectKind::MaterializedView => IconName::Eye,
                    ObjectKind::Index => IconName::Hash,
                    ObjectKind::Subscription => IconName::Broadcast,
                };
                let mut row = SidebarListItem::new(SharedString::from(format!("object-{}", object.name)), object.name.clone())
                    .in_content()
                    .active(selected.as_deref() == Some(object.name.as_str()))
                    .leading(Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let index = this.objects.iter().any(|object| object.name == name && object.kind == ObjectKind::Index);
                        if let Some(tab) = this.open_object(&name, window, cx) {
                            let mode = if index { TableMode::Info } else { TableMode::Data };
                            if let Some(TabBody::Table(table)) = this.tabs.iter_mut().find(|candidate| candidate.id == tab).map(|tab| &mut tab.body) {
                                table.mode = mode;
                            }
                            this.activate_tab(tab, window, cx);
                        }
                    }))
                    .on_secondary_mouse_down(cx.listener(move |this, _: &MouseDownEvent, window, cx| {
                        this.object_menu(&menu_name, kind, window, cx)
                    }));
                if let Some(owner) = object.owner.as_ref() {
                    row = row.description(format!("on {owner}"));
                }
                groups.push(row.into_any_element());
            }
        }

        div()
            .flex()
            .flex_col()
            .child(Self::section_title(format!("Objects ({})", listed.len()), actions, cx))
            .when(listed.is_empty(), |this| {
                this.child(
                    div()
                        .px(px(6.))
                        .py(px(24.))
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.subtle_foreground)
                        .child("No database objects"),
                )
            })
            .children(groups)
    }

    fn object_menu(&mut self, name: &str, kind: ObjectKind, window: &mut Window, cx: &mut Context<Self>) {
        let provider = self.backend.as_ref().map_or(Provider::Sqlite, |backend| backend.provider());
        let open = name.to_string();
        let query = format!("SELECT * FROM {} LIMIT 100;", provider.quote(name));
        let copy = name.to_string();
        let drop = name.to_string();
        let mut entries: Vec<MenuEntry> = Vec::new();
        if kind == ObjectKind::Subscription {
            let open = name.to_string();
            entries.push(
                self.item("Open", cx, move |this, window, cx| {
                    this.open_subscription(&open, window, cx);
                })
                .icon(IconName::Broadcast)
                .into(),
            );
        }
        if kind.has_rows() {
            entries.push(
                self.item("Open", cx, move |this, window, cx| {
                    this.open_object(&open, window, cx);
                })
                .icon(IconName::Table)
                .into(),
            );
            entries.push(
                self.item("Query", cx, move |this, window, cx| {
                    this.new_query(Some(query.clone()), window, cx);
                })
                .icon(IconName::Code)
                .into(),
            );
        }
        entries.push(
            MenuItem::new("Copy name")
                .icon(IconName::Copy)
                .on_select(move |_, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(copy.clone())))
                .into(),
        );
        entries.push(MenuEntry::Separator);
        entries.push(
            self.item(format!("Drop {}", kind_word(kind)), cx, move |this, _, cx| this.request_drop(&drop, kind, cx))
                .icon(IconName::Trash)
                .destructive()
                .into(),
        );
        self.show_menu("object-menu", entries, window, cx);
    }

    fn render_history(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let clear = Button::icon("clear-history", IconName::Broom)
            .size(ButtonSize::Small)
            .tooltip("Clear history")
            .on_click(cx.listener(|this, _, _, cx| this.remove_history(None, cx)));
        let rows: Vec<AnyElement> = self
            .history
            .iter()
            .enumerate()
            .map(|(ix, query)| {
                let pick = query.clone();
                let run = query.clone();
                let remove = query.clone();
                div()
                    .id(("history", ix))
                    .group(SharedString::from(format!("history-{ix}")))
                    .relative()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .min_h(px(26.))
                    .px(px(6.))
                    .rounded(metrics::RADIUS_MD)
                    .hover(|style| style.bg(colors.accent))
                    .child(Icon::new(IconName::Clock).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .font_family(typography::MONO_FONT)
                            .text_size(typography::TEXT_CAPTION)
                            .text_color(colors.muted_foreground)
                            .child(crate::history::preview(query)),
                    )
                    .child(
                        div()
                            .absolute()
                            .right(px(2.))
                            .flex()
                            .gap(px(2.))
                            .invisible()
                            .group_hover(SharedString::from(format!("history-{ix}")), |style| style.visible())
                            .child(
                                Button::icon(("run-history", ix), IconName::Play)
                                    .size(ButtonSize::XSmall)
                                    .tooltip("Run")
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        cx.stop_propagation();
                                        this.use_history(&run, true, window, cx)
                                    })),
                            )
                            .child(
                                Button::icon(("remove-history", ix), IconName::X)
                                    .size(ButtonSize::XSmall)
                                    .tooltip("Remove")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        cx.stop_propagation();
                                        this.remove_history(Some(&remove), cx)
                                    })),
                            ),
                    )
                    .on_click(cx.listener(move |this, _, window, cx| this.use_history(&pick, false, window, cx)))
                    .into_any_element()
            })
            .collect();
        div().flex().flex_col().child(Self::section_title("History", clear, cx)).children(rows)
    }

    // The main area.

    fn render_main(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let centered = |content: AnyElement| {
            div().flex().flex_1().min_w_0().items_center().justify_center().child(content).into_any_element()
        };
        match self.state.clone() {
            ConnectionState::Disconnected if self.connection.is_none() => self.render_home(window, cx),
            ConnectionState::Disconnected => centered(
                EmptyState::new("Database")
                    .icon(IconName::Database)
                    .message("Open a SQLite file, or connect to PostgreSQL, MySQL, MongoDB or Redis.")
                    .action(
                        Button::new("open-file", "Open Database File…")
                            .leading_icon(IconName::FolderOpen)
                            .on_click(Self::listener_click(cx, |this, window, cx| this.open_database_file(window, cx))),
                    )
                    .action(
                        Button::new("new-connection", "New Connection…")
                            .variant(ButtonVariant::Accent)
                            .leading_icon(IconName::PlugsConnected)
                            .on_click(Self::listener_click(cx, |this, window, cx| this.show_connection_form(None, window, cx))),
                    )
                    .into_any_element(),
            ),
            ConnectionState::Connecting => centered(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .text_size(typography::TEXT_SM)
                    .text_color(colors.muted_foreground)
                    .child(Icon::new(IconName::ArrowsClockwise).size(IconSize::Small).color(colors.subtle_foreground))
                    .child(format!(
                        "Connecting to {}…",
                        self.connection.as_ref().map_or("the database", |connection| connection.name.as_str())
                    ))
                    .into_any_element(),
            ),
            ConnectionState::Failed(error) => {
                let editable = self.connection.as_ref().filter(|connection| self.saved.iter().any(|saved| saved.id == connection.id)).cloned();
                centered(
                    EmptyState::new("Could not connect")
                        .icon(IconName::WarningCircle)
                        .message(error)
                        .action(Button::new("retry", "Try Again").on_click(Self::listener_click(cx, |this, window, cx| this.reconnect(window, cx))))
                        .when_some(editable, |state, connection| {
                            state.action(
                                Button::new("edit-failed", "Edit Connection…")
                                    .variant(ButtonVariant::Accent)
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.show_connection_form(Some(connection.clone()), window, cx)
                                    })),
                            )
                        })
                        .into_any_element(),
                )
            }
            ConnectionState::Connected if self.mongo.is_some() => self.render_mongo(window, cx),
            ConnectionState::Connected if self.redis.is_some() => self.render_redis(window, cx),
            ConnectionState::Connected => match self.active_tab {
                Some(_) => self.render_active_tab(window, cx),
                None => div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .px(px(12.))
                    .py(px(24.))
                    .text_size(typography::TEXT_SM)
                    .text_color(colors.subtle_foreground)
                    .child("Select a table, or open the SQL editor.")
                    .into_any_element(),
            },
        }
    }

    /// `TableToolbar`: the breadcrumb (database, then the object) with the counts, Data / Schema /
    /// Info, and the actions for what is shown.
    fn render_db_toolbar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let file_name = self.connection.as_ref().map_or_else(String::new, |connection| connection.name.clone());
        let object = self.object_tab().and_then(DbTab::object_name).map(str::to_string);
        let in_query = self.active().is_some_and(|tab| matches!(tab.body, TabBody::Query(_)));
        let mode = match self.active().map(|tab| &tab.body) {
            Some(TabBody::Table(table)) => table.mode,
            Some(TabBody::Subscription(sub)) => sub.mode,
            _ => TableMode::Data,
        };
        let subscription = matches!(self.object_tab().map(|tab| &tab.body), Some(TabBody::Subscription(_)));
        // As the original's `dbInfo`: tables and views together, then the indexes.
        let tables = self.objects.iter().filter(|object| object.kind != ObjectKind::Index).count();
        let detail = self.info.as_ref().map(|info| format!("{tables} tables · {} indexes", info.indexes));
        let rows = self.active().map_or(0, |tab| tab.grid.read(cx).row_count());
        let has_data = mode == TableMode::Data && self.active_result(cx).is_some();
        let pages = self.active().and_then(DbTab::table).map_or(1, TableTab::page_count);
        let summary = has_data.then(|| match (in_query, pages > 1) {
            (true, true) => format!("{} query rows on this page", format::format_count(rows as u64)),
            (true, false) => format!("{} query rows", format::format_count(rows as u64)),
            (false, _) => format!("{} visible rows", format::format_count(rows as u64)),
        });
        let mode_value = match mode {
            TableMode::Data => "data",
            TableMode::Structure => "schema",
            TableMode::Info => "info",
        };
        let view = cx.entity().downgrade();
        let icon = |id: &'static str, icon: IconName, tooltip: &'static str| Button::icon(id, icon).variant(ButtonVariant::Ghost).size(ButtonSize::Small).tooltip(tooltip);
        let mut segments = vec![file_name];
        segments.extend(object);
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .h(px(TOOLBAR_HEIGHT))
            .pl(px(12.))
            .pr(px(8.))
            .text_size(typography::TEXT_SM)
            .child(
                div()
                    .id("database-breadcrumb")
                    .flex()
                    .items_center()
                    .min_w_0()
                    .child(PathBreadcrumb::new("database-path", segments).icons(vec![Some(IconName::Database)]).on_segment_click({
                        let view = view.clone();
                        move |index, _, window, cx| {
                            if index == 0 {
                                view.update(cx, |this, cx| this.connection_menu(window, cx)).ok();
                            }
                        }
                    })),
            )
            .children(detail.map(|detail| div().flex_none().ml(px(4.)).text_color(colors.subtle_foreground).child(detail)))
            .child(div().flex_1())
            .child(
                Tabs::new(
                    "database-mode",
                    vec![TabsTrigger::new("data", "Data"), TabsTrigger::new("schema", "Schema"), TabsTrigger::new("info", "Info")],
                    mode_value,
                )
                .on_change(move |value, window, cx| {
                    let mode = match value.as_ref() {
                        "schema" => TableMode::Structure,
                        "info" => TableMode::Info,
                        _ => TableMode::Data,
                    };
                    view.update(cx, |this, cx| this.set_view_mode(mode, window, cx)).ok();
                }),
            )
            .when(mode == TableMode::Data && !in_query && !subscription, |this| {
                this.child(
                    icon("toggle-types", IconName::Columns, if self.show_types { "Hide column types" } else { "Show column types" })
                        .on_click(cx.listener(|this, _, _, cx| this.toggle_types(cx))),
                )
            })
            .children(summary.map(|summary| {
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .h(metrics::CHROME_CONTROL)
                    .px(px(8.))
                    .rounded_full()
                    .bg(colors.surface)
                    .text_color(colors.subtle_foreground)
                    .child(summary)
            }))
            .when(mode == TableMode::Data, |this| {
                this.child(
                    icon("open-sql", IconName::Code, "Open SQL editor")
                        .disabled(in_query)
                        .on_click(Self::listener_click(cx, |this, window, cx| {
                            this.new_query(None, window, cx);
                        })),
                )
            })
            .when(has_data, |this| {
                this.child(
                    icon("export-csv", IconName::Download, if in_query { "Export visible query page as CSV" } else { "Export visible page as CSV" })
                        .on_click(cx.listener(|this, _, _, cx| this.export_csv(cx))),
                )
                .child(
                    icon("copy-json", IconName::ClipboardText, if in_query { "Copy visible query page as JSON" } else { "Copy visible page as JSON" })
                        .on_click(cx.listener(|this, _, _, cx| this.copy_result(true, cx))),
                )
            })
    }

    /// The database's own actions, from its name in the breadcrumb: the connection's settings,
    /// saving it, reconnecting and closing.
    pub(crate) fn connection_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(connection) = self.connection.clone() else { return };
        let saved = self.saved.iter().any(|saved| saved.id == connection.id);
        let mut entries: Vec<MenuEntry> = Vec::new();
        if saved {
            let edit = connection.clone();
            entries.push(this_item(self, "Edit Connection…", IconName::Pencil, cx, move |this, window, cx| this.show_connection_form(Some(edit.clone()), window, cx)));
        } else {
            entries.push(this_item(self, "Save Connection", IconName::Pin, cx, |this, _, cx| this.remember_connection(cx)));
        }
        entries.push(this_item(self, "Reconnect", IconName::ArrowClockwise, cx, |this, window, cx| this.reconnect(window, cx)));
        entries.push(MenuEntry::Separator);
        entries.push(this_item(self, "New Connection…", IconName::PlugsConnected, cx, |this, window, cx| this.show_connection_form(None, window, cx)));
        entries.push(this_item(self, "Open Database File…", IconName::FolderOpen, cx, |this, window, cx| this.open_database_file(window, cx)));
        entries.push(MenuEntry::Separator);
        entries.push(this_item(self, "Disconnect", IconName::X, cx, |this, _, cx| this.disconnect(cx)));
        self.show_menu("connection", entries, window, cx);
    }

    /// No database open: the saved connections, a new one, or a database file.
    fn render_home(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        div()
            .id("database-home")
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .items_center()
            .overflow_y_scroll()
            .py(px(48.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .w_full()
                    .max_w(px(560.))
                    .px(px(16.))
                    .child(
                        EmptyState::new("Open a database")
                            .icon(IconName::Database)
                            .message("Open a SQLite or DuckDB file, or connect to PostgreSQL, MySQL, MongoDB or Redis.")
                            .action(
                                Button::new("open-file", "Open Database File…")
                                    .leading_icon(IconName::FolderOpen)
                                    .on_click(Self::listener_click(cx, |this, window, cx| this.open_database_file(window, cx))),
                            )
                            .action(
                                Button::new("new-connection", "New Connection…")
                                    .variant(ButtonVariant::Accent)
                                    .leading_icon(IconName::PlugsConnected)
                                    .on_click(Self::listener_click(cx, |this, window, cx| this.show_connection_form(None, window, cx))),
                            ),
                    )
                    .when(!self.saved.is_empty(), |this| this.child(self.render_connections(cx))),
            )
            .scrollbar(window, cx)
            .into_any_element()
    }

    /// `InfoView`: the database's counts, its objects and the recent queries.
    fn render_info(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let info = self.info.clone().unwrap_or_default();
        let selected = self.object_tab().and_then(DbTab::object_name).map(str::to_string);
        let filters = self.object_tab().and_then(DbTab::table).map_or(0, |table| table.filters.len());
        let name = self.connection.as_ref().map_or_else(String::new, |connection| connection.name.clone());
        let mut groups: Vec<AnyElement> = Vec::new();
        for kind in ObjectKind::ORDER {
            let objects: Vec<_> = self.objects.iter().filter(|object| object.kind == kind).cloned().collect();
            if objects.is_empty() {
                continue;
            }
            groups.push(
                div()
                    .mb(px(4.))
                    .text_color(colors.subtle_foreground)
                    .child(format!("{} ({})", kind.group_label().to_uppercase(), objects.len()))
                    .into_any_element(),
            );
            for object in objects {
                let open = object.name.clone();
                let mut row = SidebarListItem::new(SharedString::from(format!("info-object-{}", object.name)), object.name.clone())
                    .in_content()
                    .active(selected.as_deref() == Some(object.name.as_str()))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if this.open_object(&open, window, cx).is_some() {
                            this.set_view_mode(TableMode::Data, window, cx);
                        }
                    }));
                if let Some(owner) = object.owner.as_ref() {
                    row = row.description(format!("on {owner}"));
                }
                groups.push(row.into_any_element());
            }
        }
        let divider = || div().h(px(1.)).bg(colors.divider);
        div()
            .id("database-info")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .text_size(typography::TEXT_SM)
            .child(
                div()
                    .p(px(12.))
                    .child(div().mb(px(4.)).text_color(colors.foreground).child(name))
                    .child(
                        div()
                            .flex()
                            .gap(px(16.))
                            .text_color(colors.subtle_foreground)
                            .child(format!("{} tables", info.tables))
                            .child(format!("{} indexes", info.indexes))
                            .child(format!("v{}", if info.version.is_empty() { "0" } else { info.version.as_str() }))
                            .children(info.size_bytes.map(format::format_bytes))
                            .children(selected.clone().map(|selected| format!("current: {selected}")))
                            .when(filters > 0, |this| this.child(format!("{filters} filters"))),
                    ),
            )
            .child(divider())
            .child(div().p(px(12.)).child(div().mb(px(8.)).text_color(colors.subtle_foreground).child("objects")).child(div().flex().flex_col().gap(px(12.)).children(groups)))
            .when(!self.history.is_empty(), |this| this.child(divider()).child(div().p(px(6.)).child(self.render_history(cx))))
            .scrollbar(window, cx)
            .into_any_element()
    }

    fn render_active_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(ix) = self.tabs.iter().position(|tab| Some(tab.id) == self.active_tab) else {
            return div().into_any_element();
        };
        let tab = &self.tabs[ix];
        match &tab.body {
            TabBody::Table(_) => self.render_table_tab(ix, window, cx),
            TabBody::Query(_) => self.render_query_tab(tab, cx),
            TabBody::Subscription(sub) => self.render_subscription_tab(tab, sub, window, cx),
        }
    }

    pub(crate) fn toolbar(cx: &App) -> gpui::Div {
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .h(px(40.))
            .px(px(8.))
            .border_b_1()
            .border_color(cx.theme().colors.divider)
            .text_size(typography::TEXT_SM)
    }

    pub(crate) fn error_banner(error: &str, cx: &App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_none()
            .items_start()
            .gap(px(8.))
            .mx(px(8.))
            .my(px(6.))
            .px(px(10.))
            .py(px(8.))
            .rounded(metrics::RADIUS_LG)
            .bg(colors.destructive_soft)
            .text_size(typography::TEXT_SM)
            .text_color(colors.foreground)
            .child(div().pt(px(2.)).child(Icon::new(IconName::WarningCircle).size(IconSize::XSmall).color(colors.destructive)))
            .child(div().flex_1().min_w_0().font_family(typography::MONO_FONT).child(error.to_string()))
    }

    /// The object shown: the search bar (`QueryBar`), column filters, then the grid and its
    /// pagination for Data, `SchemaView` for Schema, or `InfoView`.
    fn render_table_tab(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let tab = &self.tabs[ix];
        let Some(table) = tab.table() else { return div().into_any_element() };
        let id = tab.id;
        let editable = table.editable() && table.schema_loaded;
        let mode = table.mode;
        if mode == TableMode::Info {
            return self.render_info(window, cx);
        }
        let more_name = table.name.clone();
        let more_kind = table.kind;
        let query_bar = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .px(px(12.))
            .pt(px(8.))
            .pb(px(4.))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .h(px(28.))
                    .px(px(10.))
                    .rounded_full()
                    .bg(colors.field)
                    .border_1()
                    .border_color(colors.divider)
                    .child(table.search.clone()),
            )
            .child(
                Button::icon("add-filter", IconName::Filter)
                    .size(ButtonSize::Small)
                    .tooltip("Add filter")
                    .disabled(!table.schema_loaded || !table.editable())
                    .on_click(cx.listener(move |this, _, window, cx| this.add_filter(id, None, FilterOp::Equals, String::new(), window, cx))),
            )
            .child(
                Button::icon("reload-table", IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .tooltip("Reload")
                    .on_click(cx.listener(move |this, _, _, cx| this.reload_table(id, false, cx))),
            )
            .when(editable, |this| {
                this.child(
                    Button::icon("new-row", IconName::Plus)
                        .size(ButtonSize::Small)
                        .tooltip("Insert a row")
                        .on_click(cx.listener(move |this, _, window, cx| this.open_row_editor(id, None, None, window, cx))),
                )
            })
            .child(
                Button::icon("table-more", IconName::Dots)
                    .size(ButtonSize::Small)
                    .tooltip("More")
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let provider = this.backend.as_ref().map_or(Provider::Sqlite, |backend| backend.provider());
                        let query = format!("SELECT * FROM {} LIMIT 100;", provider.quote(&more_name));
                        let drop = more_name.clone();
                        let mut entries: Vec<MenuEntry> = vec![
                            this.item("Copy page as CSV", cx, |this, _, cx| this.copy_result(false, cx)).icon(IconName::Copy).into(),
                            this.item("Copy page as JSON", cx, |this, _, cx| this.copy_result(true, cx)).icon(IconName::BracketsCurly).into(),
                            this.item("Save page as CSV…", cx, |this, _, cx| this.export_csv(cx)).icon(IconName::Download).into(),
                            MenuEntry::Separator,
                            this.item("Query this table", cx, move |this, window, cx| {
                                this.new_query(Some(query.clone()), window, cx);
                            })
                            .icon(IconName::Code)
                            .into(),
                        ];
                        if more_kind == ObjectKind::Table || more_kind == ObjectKind::View {
                            entries.push(MenuEntry::Separator);
                            entries.push(
                                this.item(format!("Drop {}", kind_word(more_kind)), cx, move |this, _, cx| this.request_drop(&drop, more_kind, cx))
                                    .icon(IconName::Trash)
                                    .destructive()
                                    .into(),
                            );
                        }
                        this.show_menu("table-more", entries, window, cx);
                    })),
            );

        let rows = tab.grid.read(cx).row_count();
        let result_label = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .h(px(32.))
            .px(px(12.))
            .text_size(typography::TEXT_SM)
            .text_color(colors.subtle_foreground)
            .child(match table.total {
                None if tab.loading => "Loading…".to_string(),
                _ => format!("{} {}", format::format_count(rows as u64), if rows == 1 { "row" } else { "rows" }),
            })
            .children(table.elapsed.map(|elapsed| format!("· {}", format::format_elapsed(elapsed))))
            .when(!table.filters.is_empty() || !table.search.read(cx).text().is_empty(), |this| this.child("· filtered"));
        let body = match mode {
            TableMode::Data => div()
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .child(result_label)
                .child(
                    div()
                        .flex()
                        .flex_1()
                        .min_h_0()
                        .child(div().flex().flex_col().flex_1().min_w_0().child(tab.grid.clone()))
                        .children(tab.row_editor.clone()),
                )
                .into_any_element(),
            _ => self.render_structure(id, table, editable, window, cx).into_any_element(),
        };
        let paged = mode == TableMode::Data && table.page_count() > 1;

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .child(query_bar)
            .when(!table.filters.is_empty() && mode == TableMode::Data, |this| this.child(self.render_filters(id, table, window, cx)))
            .children(tab.error.as_ref().map(|error| Self::error_banner(error, cx)))
            .child(body)
            .when(paged, |this| this.child(self.render_table_footer(tab, table, cx)))
            .into_any_element()
    }

    fn render_filters(&self, id: usize, table: &TableTab, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let columns: Vec<String> = table.columns.iter().map(|column| column.name.clone()).collect();
        let field = |child: AnyElement| {
            div()
                .flex()
                .items_center()
                .w(px(160.))
                .h(px(24.))
                .px(px(8.))
                .rounded_full()
                .bg(colors.field)
                .border_1()
                .border_color(colors.divider)
                .child(child)
        };
        let rows: Vec<AnyElement> = table
            .filters
            .iter()
            .enumerate()
            .map(|(ix, filter)| {
                let column_names = columns.clone();
                let op = filter.op;
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(
                        Button::new(("filter-column", ix), filter.column.clone())
                            .variant(ButtonVariant::Outline)
                            .size(ButtonSize::Small)
                            .trailing_icon(IconName::ChevronDown)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let entries = column_names
                                    .iter()
                                    .map(|name| {
                                        let column = name.clone();
                                        this.item(name.clone(), cx, move |this, _, cx| this.update_filter(id, ix, Some(column.clone()), None, cx))
                                            .into()
                                    })
                                    .collect();
                                this.show_menu(&format!("filter-column-{ix}"), entries, window, cx);
                            })),
                    )
                    .child(
                        Button::new(("filter-op", ix), op.label())
                            .variant(ButtonVariant::Outline)
                            .size(ButtonSize::Small)
                            .trailing_icon(IconName::ChevronDown)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let entries = FilterOp::ALL
                                    .iter()
                                    .map(|candidate| {
                                        let candidate = *candidate;
                                        this.item(candidate.label(), cx, move |this, _, cx| this.update_filter(id, ix, None, Some(candidate), cx))
                                            .checked(candidate == op)
                                            .into()
                                    })
                                    .collect();
                                this.show_menu(&format!("filter-op-{ix}"), entries, window, cx);
                            })),
                    )
                    .when(op.takes_value(), |this| this.child(field(filter.value.clone().into_any_element())))
                    .when(op == FilterOp::Between, |this| this.child(field(filter.value2.clone().into_any_element())))
                    .child(
                        Button::icon(("remove-filter", ix), IconName::X)
                            .size(ButtonSize::XSmall)
                            .tooltip("Remove filter")
                            .on_click(cx.listener(move |this, _, _, cx| this.remove_filter(id, Some(ix), cx))),
                    )
                    .into_any_element()
            })
            .collect();
        div()
            .flex()
            .flex_none()
            .flex_col()
            .gap(px(4.))
            .px(px(8.))
            .py(px(6.))
            .border_b_1()
            .border_color(colors.divider)
            .children(rows)
            .when(table.filters.len() > 1, |this| {
                this.child(
                    div().child(
                        Button::new("clear-filters", "Clear filters")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::XSmall)
                            .on_click(cx.listener(move |this, _, _, cx| this.remove_filter(id, None, cx))),
                    ),
                )
            })
    }

    /// `SchemaView`: the table's name and column count, then one row per column with its type
    /// icon, name, type, constraint labels (PK, NN, `def: …`), its foreign key in the accent colour
    /// and, where rows can be changed, a button that filters by it.
    fn render_structure(&self, id: usize, table: &TableTab, can_filter: bool, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let rows: Vec<AnyElement> = table
            .columns
            .iter()
            .enumerate()
            .map(|(index, column)| {
                let key = table
                    .foreign_keys
                    .iter()
                    .find(|key| key.from_column.trim() == column.name && !key.to_table.trim().is_empty() && !key.to_column.trim().is_empty());
                let (icon, icon_color) = column_icon(&column.ty, column.primary_key, key.is_some(), &colors);
                let hover = colors.accent;
                let name = column.name.clone();
                div()
                    .id(("schema-column", index))
                    .flex()
                    .items_center()
                    .justify_between()
                    .px(px(12.))
                    .py(px(8.))
                    .when(index > 0, |this| this.border_t_1().border_color(colors.border))
                    .hover(move |style| style.bg(hover))
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(8.))
                            .child(Icon::new(icon).size(IconSize::Small).color(icon_color))
                            .child(div().min_w_0().truncate().text_color(colors.foreground).child(column.name.clone()))
                            .child(div().flex_none().text_color(colors.subtle_foreground).child(column.ty.clone()))
                            .children(column_constraint_labels(column).into_iter().map(|label| div().min_w_0().truncate().text_color(colors.subtle_foreground).child(label)))
                            .children(key.map(|key| {
                                div().min_w_0().truncate().text_color(colors.primary).child(format!("FK {}.{}", key.to_table.trim(), key.to_column.trim()))
                            })),
                    )
                    .when(can_filter, |this| {
                        this.child(
                            Button::icon(SharedString::from(format!("schema-filter-{index}")), IconName::Filter)
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::Small)
                                .tooltip(format!("Filter by {name}"))
                                .on_click(cx.listener(move |this, _, window, cx| this.add_filter(id, Some(name.clone()), FilterOp::Equals, String::new(), window, cx))),
                        )
                    })
                    .into_any_element()
            })
            .collect();
        div()
            .id("table-structure")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .text_size(typography::TEXT_SM)
            .child(
                div()
                    .px(px(12.))
                    .py(px(12.))
                    .child(div().text_color(colors.foreground).child(table.name.clone()))
                    .child(div().text_color(colors.subtle_foreground).child(format!("{} columns", table.columns.len()))),
            )
            .child(div().mx(px(12.)).mb(px(12.)).flex().flex_col().border_y_1().border_color(colors.border).bg(colors.background).children(rows))
            .scrollbar(window, cx)
    }

    pub(crate) fn footer(cx: &App) -> gpui::Div {
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .h(px(32.))
            .px(px(10.))
            .border_t_1()
            .border_color(cx.theme().colors.divider)
            .text_size(typography::TEXT_CAPTION)
            .text_color(cx.theme().colors.subtle_foreground)
    }

    /// `Pagination`: the page size, then the page and the arrows.
    fn render_table_footer(&self, tab: &DbTab, table: &TableTab, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let id = tab.id;
        let pages = table.page_count();
        let page = table.page;
        let size = table.page_size;
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(8.))
            .h(px(44.))
            .px(px(12.))
            .border_t_1()
            .border_color(colors.divider)
            .text_size(typography::TEXT_SM)
            .text_color(colors.subtle_foreground)
            .child(
                Button::new("page-size", size.to_string())
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .trailing_icon(IconName::ChevronDown)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let entries = PAGE_SIZES
                            .iter()
                            .map(|option| {
                                let option = *option;
                                this.item(option.to_string(), cx, move |this, _, cx| this.set_page_size(id, option, cx)).checked(option == size).into()
                            })
                            .collect();
                        this.show_menu("page-size", entries, window, cx);
                    })),
            )
            .child("per page")
            .child(div().flex_1())
            .child(
                Button::icon("previous-page", IconName::ArrowLeft)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .disabled(page == 0)
                    .tooltip("Previous page")
                    .on_click(cx.listener(move |this, _, _, cx| this.set_page(id, page.saturating_sub(1), cx))),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_center()
                    .min_w(px(48.))
                    .h(metrics::CHROME_CONTROL)
                    .px(px(8.))
                    .rounded_full()
                    .bg(colors.field)
                    .text_color(colors.foreground)
                    .child(format::format_count(page as u64 + 1)),
            )
            .child(format!("/ {}", format::format_count(pages as u64)))
            .child(
                Button::icon("next-page", IconName::ArrowRight)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .disabled(page + 1 >= pages)
                    .tooltip("Next page")
                    .on_click(cx.listener(move |this, _, _, cx| this.set_page(id, page + 1, cx))),
            )
    }

    /// The query bar's completions (`query-bar.tsx`): a row of words under the editor, Tab
    /// taking the first.
    fn render_sql_completions(&self, editor: &Entity<SqlEditor>, cx: &mut Context<Self>) -> Option<AnyElement> {
        let tables = self
            .objects
            .iter()
            .filter(|object| matches!(object.kind, ObjectKind::Table | ObjectKind::View | ObjectKind::MaterializedView))
            .map(|object| object.name.clone())
            .collect();
        let mut columns: Vec<String> = Vec::new();
        for tab in &self.tabs {
            if let TabBody::Table(table) = &tab.body {
                for column in &table.columns {
                    if !columns.contains(&column.name) {
                        columns.push(column.name.clone());
                    }
                }
            }
        }
        let completions = editor.update(cx, |editor, _| {
            editor.set_completion_source(tables, columns);
            editor.completions()
        })?;
        let buttons = completions.items.into_iter().enumerate().map(|(index, item)| {
            let editor = editor.clone();
            Button::new(("sql-completion", index), item.value.clone())
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip(item.detail)
                .on_click(move |_, window, cx| editor.update(cx, |editor, cx| editor.apply_completion(index, window, cx)))
        });
        Some(div().flex().flex_wrap().gap(px(4.)).mx(px(12.)).mb(px(4.)).children(buttons).into_any_element())
    }

    fn render_query_tab(&self, tab: &DbTab, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let TabBody::Query(query) = &tab.body else { return div().into_any_element() };
        let has_rows = query.outcome.as_ref().is_some_and(|outcome| outcome.affected.is_none());
        let toolbar = Self::toolbar(cx)
            .child(
                Button::new("run-query", if tab.loading { "Running…" } else { "Run" })
                    .variant(ButtonVariant::Accent)
                    .size(ButtonSize::Small)
                    .leading_icon(IconName::Play)
                    .shortcut("⌘↵")
                    .tooltip("Run the selection, or everything")
                    .disabled(tab.loading)
                    .on_click(cx.listener(|this, _, _, cx| this.run_active_query(cx))),
            )
            .child(div().flex_1())
            .when(has_rows, |this| {
                this.child(
                    Button::icon("query-copy-csv", IconName::Copy)
                        .size(ButtonSize::Small)
                        .tooltip("Copy as CSV")
                        .on_click(cx.listener(|this, _, _, cx| this.copy_result(false, cx))),
                )
            })
            .child(
                Button::icon("close-sql", IconName::X)
                    .size(ButtonSize::Small)
                    .tooltip("Close SQL editor")
                    .on_click(cx.listener(|this, _, window, cx| this.close_query(window, cx))),
            );

        let result: AnyElement = match (&tab.error, &query.outcome) {
            (Some(error), _) => div().flex().flex_col().flex_1().child(Self::error_banner(error, cx)).into_any_element(),
            (None, Some(outcome)) if outcome.affected.is_some() => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(
                    EmptyState::new("Statement ran")
                        .icon(IconName::CheckCircle)
                        .message(format!(
                            "{} {} changed in {}.",
                            format::format_count(outcome.affected.unwrap_or(0)),
                            if outcome.affected == Some(1) { "row" } else { "rows" },
                            format::format_elapsed(outcome.elapsed)
                        )),
                )
                .into_any_element(),
            (None, Some(_)) => div().flex().flex_col().flex_1().min_h_0().child(tab.grid.clone()).into_any_element(),
            (None, None) => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::TEXT_SM)
                .text_color(colors.subtle_foreground)
                .child(if tab.loading { "Running…" } else { "Run a query to see its rows here." })
                .into_any_element(),
        };

        let footer = query.outcome.as_ref().filter(|outcome| outcome.affected.is_none()).map(|outcome| {
            let rows = tab.grid.read(cx).row_count();
            Self::footer(cx)
                .child(format!("{} {}", format::format_count(rows as u64), if rows == 1 { "row" } else { "rows" }))
                .child(format!("· {}", format::format_elapsed(outcome.elapsed)))
                .when(outcome.truncated, |this| {
                    this.child(format!("· first {} shown", format::format_count(crate::model::MAX_QUERY_ROWS as u64)))
                })
        });

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .child(toolbar)
            .child(
                div()
                    .flex()
                    .flex_none()
                    .h(px(80.))
                    .mx(px(12.))
                    .mb(px(4.))
                    .overflow_hidden()
                    .rounded(metrics::RADIUS_LG)
                    .bg(colors.surface)
                    .child(query.editor.clone()),
            )
            .children(self.render_sql_completions(&query.editor, cx))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .child(div().flex().flex_col().flex_1().min_w_0().child(result))
                    .children(tab.row_editor.clone()),
            )
            .children(footer)
            .into_any_element()
    }

    // Dialogs.

    fn render_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let content = match self.dialog.as_ref()? {
            Dialog::Connection { form, .. } => form.clone().into_any_element(),
            Dialog::CreateTable { form, .. } => form.clone().into_any_element(),
            Dialog::CreateSubscription { form, .. } => form.clone().into_any_element(),
            Dialog::Json { title, text } => div()
                .w(px(560.))
                .max_w_full()
                .child(
                    ui::Dialog::new("json-viewer", title.clone())
                        .icon(IconName::BracketsCurly)
                        .size(ui::DialogSize::Lg)
                        .on_close({
                            let view = cx.entity().downgrade();
                            move |_, cx| {
                                view.update(cx, |this, cx| this.dismiss_dialog(cx)).ok();
                            }
                        })
                        .child(crate::mongo_browser::code_block(text, cx))
                        .footer([
                            Button::new("copy-json", "Copy")
                                .leading_icon(IconName::Copy)
                                .on_click({
                                    let text = text.clone();
                                    move |_, _, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.clone()))
                                })
                                .into_any_element(),
                            Button::new("close-json", "Close")
                                .variant(ButtonVariant::Accent)
                                .on_click(cx.listener(|this, _, _, cx| this.dismiss_dialog(cx)))
                                .into_any_element(),
                        ]),
                )
                .into_any_element(),
            Dialog::Confirm(confirm) => div()
                .id("confirm-dialog")
                .occlude()
                .flex()
                .flex_col()
                .w(px(460.))
                .max_w_full()
                .rounded(metrics::ISLAND_RADIUS)
                .bg(colors.overlay)
                .shadow(theme.shadows.dialog.clone())
                .text_size(typography::TEXT_SM)
                .text_color(colors.foreground)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .p(px(16.))
                        .child(div().text_size(typography::TEXT_BASE).font_weight(typography::SEMIBOLD).child(confirm.title.clone()))
                        .child(div().text_color(colors.muted_foreground).child(confirm.message.clone()))
                        .children(confirm.sql.clone().map(|sql| {
                            div()
                                .id("confirm-sql")
                                .mt(px(6.))
                                .max_h(px(160.))
                                .overflow_y_scroll()
                                .p(px(10.))
                                .rounded(metrics::RADIUS_LG)
                                .bg(colors.field)
                                .font_family(typography::MONO_FONT)
                                .text_size(typography::TEXT_CAPTION)
                                .child(sql)
                                .scrollbar(window, cx)
                        }))
                        .children(confirm.error.clone().map(|error| div().mt(px(4.)).text_color(colors.destructive).child(error))),
                )
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(8.))
                        .px(px(16.))
                        .py(px(12.))
                        .border_t_1()
                        .border_color(colors.divider)
                        .child(Button::new("confirm-cancel", "Cancel").on_click(cx.listener(|this, _, _, cx| this.dismiss_dialog(cx))))
                        .child(
                            Button::new("confirm-ok", if confirm.running { SharedString::from("Working…") } else { confirm.confirm_label.clone() })
                                .variant(if confirm.destructive { ButtonVariant::Destructive } else { ButtonVariant::Accent })
                                .tone(if confirm.destructive { ButtonTone::Danger } else { ButtonTone::Default })
                                .disabled(confirm.running)
                                .on_click(cx.listener(|this, _, _, cx| this.confirm(cx))),
                        ),
                )
                .into_any_element(),
        };
        let dismissable = matches!(self.dialog, Some(Dialog::Confirm(_) | Dialog::Json { .. }));
        Some(
            div()
                .id("database-dialog")
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .p(px(24.))
                .bg(colors.scrim)
                .occlude()
                .when(dismissable, |this| {
                    this.on_mouse_down(MouseButton::Left, cx.listener(|this, _, _, cx| this.dismiss_dialog(cx)))
                })
                .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, _, cx| {
                    if event.keystroke.key == "escape" {
                        this.dismiss_dialog(cx);
                    }
                }))
                .child(div().on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation()).child(content))
                .into_any_element(),
        )
    }
}

fn this_item(
    view: &DatabaseView,
    label: &'static str,
    icon: IconName,
    cx: &mut Context<DatabaseView>,
    action: impl Fn(&mut DatabaseView, &mut Window, &mut Context<DatabaseView>) + 'static,
) -> MenuEntry {
    view.item(label, cx, action).icon(icon).into()
}

fn provider_icon(provider: Provider) -> IconName {
    if provider.is_file_based() { IconName::Database } else { IconName::HardDrives }
}

fn kind_word(kind: ObjectKind) -> &'static str {
    match kind {
        ObjectKind::Table => "table",
        ObjectKind::View => "view",
        ObjectKind::MaterializedView => "materialized view",
        ObjectKind::Index => "index",
        ObjectKind::Subscription => "subscription",
    }
}

impl Render for DatabaseView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let connected = self.state == ConnectionState::Connected;
        let sql = connected && self.mongo.is_none() && self.redis.is_none();
        let main = self.render_main(window, cx);
        let content = if sql {
            div()
                .flex()
                .flex_col()
                .size_full()
                .min_h_0()
                .child(self.render_db_toolbar(cx))
                .child(
                    div()
                        .flex()
                        .flex_1()
                        .min_h_0()
                        .child(self.render_sidebar(window, cx))
                        .child(div().flex().flex_col().flex_1().min_w_0().min_h_0().child(main)),
                )
                .into_any_element()
        } else if connected {
            div().flex().size_full().min_h_0().child(self.render_sidebar(window, cx)).child(main).into_any_element()
        } else {
            div().flex().size_full().min_h_0().child(main).into_any_element()
        };
        div()
            .id("database-view")
            .track_focus(&self.focus_handle)
            .relative()
            .flex()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .text_color(colors.foreground)
            .font_family(typography::UI_FONT)
            .child(content)
            .children(self.render_dialog(window, cx))
            .children(self.open_menu.as_ref().map(OpenMenu::render))
    }
}

/// `getColumnConstraintLabels`: PK, NN and the default.
fn column_constraint_labels(column: &crate::model::Column) -> Vec<String> {
    let mut labels = Vec::new();
    if column.primary_key {
        labels.push("PK".to_string());
    }
    if column.notnull {
        labels.push("NN".to_string());
    }
    if let Some(default) = &column.default_value {
        labels.push(format!("def: {default}"));
    }
    labels
}

/// `getColumnIcon`: a key for the primary key, a link for a foreign key, else by type.
fn column_icon(ty: &str, primary_key: bool, foreign_key: bool, colors: &theme::ThemeColors) -> (IconName, Hsla) {
    if primary_key {
        return (IconName::Key, colors.subtle_foreground);
    }
    if foreign_key {
        return (IconName::Link, colors.primary);
    }
    let ty = ty.to_lowercase();
    const ICONS: [(&str, IconName, bool); 9] = [
        ("int", IconName::Hash, true),
        ("num", IconName::Hash, true),
        ("text", IconName::Text, false),
        ("varchar", IconName::Text, false),
        ("char", IconName::Text, false),
        ("date", IconName::Calendar, true),
        ("time", IconName::Calendar, true),
        ("blob", IconName::FileText, false),
        ("binary", IconName::FileText, false),
    ];
    ICONS
        .iter()
        .find(|(key, _, _)| ty.contains(key))
        .map(|(_, icon, accent)| (*icon, if *accent { colors.primary } else { colors.subtle_foreground }))
        .unwrap_or((IconName::Text, colors.subtle_foreground))
}
