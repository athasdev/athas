//! The MongoDB browser (`providers/mongodb/mongodb-viewer.tsx`): a database, its collections in
//! the sidebar, and a page of documents a JSON filter and sort pick.

use std::time::Duration;

use gpui::{AnyElement, App, Context, Entity, SharedString, Window, div, prelude::*, px};
use serde_json::Value;
use theme::ActiveTheme;
use ui::{
    Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, SidebarListItem, TextInput, TextInputEvent,
    WithScrollbar, metrics, typography,
};
use web_time::Instant;

use crate::{
    Confirm, DatabaseView, Dialog, PendingAction, format,
    nosql::{self, DEFAULT_MONGO_PAGE_SIZE, MONGO_PAGE_SIZES, MongoCollection, MongoPage},
};

pub(crate) struct MongoBrowser {
    pub databases: Vec<String>,
    pub database: Option<String>,
    pub collections: Vec<MongoCollection>,
    pub collection: Option<String>,
    pub documents: Vec<Value>,
    pub total: u64,
    pub page: usize,
    pub page_size: usize,
    pub filter: Entity<TextInput>,
    pub sort: Entity<TextInput>,
    pub filter_json: String,
    pub sort_json: String,
    pub loading: bool,
    pub error: Option<String>,
    pub elapsed: Option<Duration>,
    request: u64,
}

impl MongoBrowser {
    pub fn new(window: &mut Window, cx: &mut Context<DatabaseView>) -> Self {
        let input = |placeholder: &str, window: &mut Window, cx: &mut Context<DatabaseView>| {
            let placeholder = placeholder.to_string();
            let input = cx.new(|cx| {
                let mut input = TextInput::new(window, cx).placeholder(placeholder).appearance(ui::InputAppearance::Bare);
                input.set_text("{}", cx);
                input
            });
            cx.subscribe(&input, |this, _, event: &TextInputEvent, cx| {
                if let TextInputEvent::Confirmed = event {
                    this.apply_mongo_query(cx);
                }
            })
            .detach();
            input
        };
        Self {
            databases: Vec::new(),
            database: None,
            collections: Vec::new(),
            collection: None,
            documents: Vec::new(),
            total: 0,
            page: 0,
            page_size: DEFAULT_MONGO_PAGE_SIZE,
            filter: input(r#"Filter JSON, e.g. {"name": "John"}"#, window, cx),
            sort: input(r#"Sort JSON, e.g. {"createdAt": -1}"#, window, cx),
            filter_json: "{}".into(),
            sort_json: "{}".into(),
            loading: true,
            error: None,
            elapsed: None,
            request: 0,
        }
    }

    pub fn page_count(&self) -> usize {
        nosql::page_count(self.total, self.page_size)
    }

    fn clear_documents(&mut self) {
        self.documents.clear();
        self.total = 0;
        self.page = 0;
        self.elapsed = None;
        self.filter_json = "{}".into();
        self.sort_json = "{}".into();
    }
}

impl DatabaseView {
    /// Lists the server's databases and opens the connection's own (or the first).
    pub(crate) fn start_mongo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(backend) = self.backend.clone() else { return };
        self.mongo = Some(MongoBrowser::new(window, cx));
        let preferred = self.connection.as_ref().map(|connection| connection.database.trim().to_string());
        let generation = self.generation;
        let task = cx.background_spawn(async move { backend.mongo_databases() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                let Some(mongo) = this.mongo.as_mut() else { return };
                mongo.loading = false;
                match result {
                    Ok(databases) => {
                        let pick = preferred
                            .filter(|name| databases.contains(name))
                            .or_else(|| databases.first().cloned());
                        mongo.databases = databases;
                        if let Some(database) = pick {
                            this.select_mongo_database(database, cx);
                        }
                    }
                    Err(error) => mongo.error = Some(format!("Failed to load databases: {error}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn select_mongo_database(&mut self, database: String, cx: &mut Context<Self>) {
        self.open_menu = None;
        let Some(backend) = self.backend.clone() else { return };
        let Some(mongo) = self.mongo.as_mut() else { return };
        mongo.request += 1;
        let request = mongo.request;
        mongo.database = Some(database.clone());
        mongo.collections.clear();
        mongo.collection = None;
        mongo.clear_documents();
        mongo.loading = true;
        mongo.error = None;
        let generation = self.generation;
        let name = database.clone();
        let task = cx.background_spawn(async move { backend.mongo_collections(&name) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                let Some(mongo) = this.mongo.as_mut().filter(|mongo| mongo.request == request) else { return };
                mongo.loading = false;
                match result {
                    Ok(collections) => {
                        let first = collections.first().map(|collection| collection.name.clone());
                        mongo.collections = collections;
                        if let Some(first) = first {
                            this.select_mongo_collection(first, cx);
                        }
                    }
                    Err(error) => mongo.error = Some(format!("Failed to load collections: {error}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    pub(crate) fn select_mongo_collection(&mut self, collection: String, cx: &mut Context<Self>) {
        let Some(mongo) = self.mongo.as_mut() else { return };
        mongo.collection = Some(collection);
        mongo.clear_documents();
        mongo.error = None;
        let (filter, sort) = (mongo.filter.clone(), mongo.sort.clone());
        filter.update(cx, |input, cx| input.set_text("{}", cx));
        sort.update(cx, |input, cx| input.set_text("{}", cx));
        self.refresh_mongo(cx);
    }

    /// Loads the current page with the applied filter and sort.
    pub(crate) fn refresh_mongo(&mut self, cx: &mut Context<Self>) {
        let Some(backend) = self.backend.clone() else { return };
        let Some(mongo) = self.mongo.as_mut() else { return };
        let (Some(database), Some(collection)) = (mongo.database.clone(), mongo.collection.clone()) else { return };
        if let Some(error) =
            nosql::query_json_error(&mongo.filter_json, "filter").or_else(|| nosql::query_json_error(&mongo.sort_json, "sort"))
        {
            mongo.error = Some(error);
            mongo.loading = false;
            cx.notify();
            return;
        }
        mongo.request += 1;
        let request = mongo.request;
        mongo.loading = true;
        mongo.error = None;
        let (filter, sort, page, page_size) = (mongo.filter_json.clone(), mongo.sort_json.clone(), mongo.page, mongo.page_size);
        let generation = self.generation;
        let task = cx.background_spawn(async move {
            let started = Instant::now();
            let result = backend.mongo_documents(&database, &collection, &filter, &sort, page, page_size)?;
            anyhow::Ok((result, started.elapsed()))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                let Some(mongo) = this.mongo.as_mut().filter(|mongo| mongo.request == request) else { return };
                mongo.loading = false;
                match result {
                    Ok(((MongoPage { documents, total }, page), elapsed)) => {
                        mongo.documents = documents;
                        mongo.total = total;
                        mongo.page = page;
                        mongo.elapsed = Some(elapsed);
                    }
                    Err(error) => mongo.error = Some(format!("Query failed: {error}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    pub(crate) fn apply_mongo_query(&mut self, cx: &mut Context<Self>) {
        let Some(mongo) = self.mongo.as_mut() else { return };
        mongo.filter_json = nosql::normalize_query_json(mongo.filter.read(cx).text());
        mongo.sort_json = nosql::normalize_query_json(mongo.sort.read(cx).text());
        mongo.page = 0;
        self.refresh_mongo(cx);
    }

    pub(crate) fn reset_mongo_query(&mut self, cx: &mut Context<Self>) {
        let Some(mongo) = self.mongo.as_mut() else { return };
        let (filter, sort) = (mongo.filter.clone(), mongo.sort.clone());
        filter.update(cx, |input, cx| input.set_text("{}", cx));
        sort.update(cx, |input, cx| input.set_text("{}", cx));
        self.apply_mongo_query(cx);
    }

    pub(crate) fn set_mongo_page(&mut self, page: usize, cx: &mut Context<Self>) {
        let Some(mongo) = self.mongo.as_mut() else { return };
        let page = page.min(mongo.page_count() - 1);
        if page == mongo.page {
            return;
        }
        mongo.page = page;
        self.refresh_mongo(cx);
    }

    pub(crate) fn set_mongo_page_size(&mut self, size: usize, cx: &mut Context<Self>) {
        self.open_menu = None;
        let Some(mongo) = self.mongo.as_mut() else { return };
        mongo.page_size = size.clamp(1, 500);
        mongo.page = 0;
        self.refresh_mongo(cx);
    }

    pub(crate) fn request_delete_document(&mut self, ix: usize, cx: &mut Context<Self>) {
        let Some(mongo) = self.mongo.as_ref() else { return };
        let (Some(database), Some(collection)) = (mongo.database.clone(), mongo.collection.clone()) else { return };
        let Some(document) = mongo.documents.get(ix) else { return };
        let Some(filter) = nosql::document_id_filter(document) else { return };
        self.dialog = Some(Dialog::Confirm(Confirm {
            title: "Delete document?".into(),
            message: format!("This deletes the document from {collection}. It cannot be undone.").into(),
            sql: Some(format!("db.{collection}.deleteOne({filter})").into()),
            confirm_label: "Delete".into(),
            destructive: true,
            action: PendingAction::DeleteDocument { database, collection, filter },
            running: false,
            error: None,
        }));
        cx.notify();
    }

    pub(crate) fn render_mongo_collections(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let Some(mongo) = self.mongo.as_ref() else { return div() };
        let selected = mongo.collection.clone();
        let rows: Vec<AnyElement> = mongo
            .collections
            .iter()
            .enumerate()
            .map(|(ix, collection)| {
                let name = collection.name.clone();
                SidebarListItem::new(("mongo-collection", ix), collection.name.clone())
                    .in_content()
                    .active(selected.as_deref() == Some(collection.name.as_str()))
                    .leading(Icon::new(IconName::Stack).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .trailing(div().text_size(typography::TEXT_CAPTION).child(format::format_count(collection.count)))
                    .on_click(cx.listener(move |this, _, _, cx| this.select_mongo_collection(name.clone(), cx)))
                    .into_any_element()
            })
            .collect();
        let empty = rows.is_empty() && !mongo.loading;
        let refresh = Button::icon("refresh-collections", IconName::ArrowClockwise)
            .size(ButtonSize::Small)
            .tooltip("Refresh")
            .on_click(cx.listener(|this, _, _, cx| {
                if let Some(database) = this.mongo.as_ref().and_then(|mongo| mongo.database.clone()) {
                    this.select_mongo_database(database, cx);
                }
            }));
        div()
            .flex()
            .flex_col()
            .child(Self::section_title(format!("Collections ({})", mongo.collections.len()), refresh, cx))
            .when(empty, |this| {
                this.child(
                    div()
                        .px(px(6.))
                        .py(px(4.))
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.subtle_foreground)
                        .child("No collections"),
                )
            })
            .children(rows)
    }

    pub(crate) fn render_mongo(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(mongo) = self.mongo.as_ref() else { return div().into_any_element() };
        let database_label = mongo.database.clone().unwrap_or_else(|| "No database".into());
        let databases = mongo.databases.clone();
        let current = mongo.database.clone();
        let field = |child: AnyElement| {
            div()
                .flex()
                .items_center()
                .h(px(26.))
                .px(px(10.))
                .rounded_full()
                .bg(colors.field)
                .border_1()
                .border_color(colors.divider)
                .font_family(typography::MONO_FONT)
                .child(child)
        };
        let toolbar = Self::toolbar(cx)
            .child(
                Button::new("mongo-database", database_label)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .leading_icon(IconName::Database)
                    .trailing_icon(IconName::ChevronDown)
                    .disabled(databases.is_empty())
                    .tooltip("Database")
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let entries = databases
                            .iter()
                            .map(|name| {
                                let database = name.clone();
                                this.item(name.clone(), cx, move |this, _, cx| this.select_mongo_database(database.clone(), cx))
                                    .checked(current.as_deref() == Some(name.as_str()))
                                    .into()
                            })
                            .collect();
                        this.show_menu("mongo-database", entries, window, cx);
                    })),
            )
            .child(div().w(px(1.)).h(px(16.)).mx(px(4.)).bg(colors.divider))
            .child(field(mongo.filter.clone().into_any_element()).flex_1().min_w_0())
            .child(field(mongo.sort.clone().into_any_element()).w(px(200.)).flex_none())
            .child(
                Button::new("mongo-apply", "Apply")
                    .variant(ButtonVariant::Accent)
                    .size(ButtonSize::Small)
                    .leading_icon(IconName::BracketsCurly)
                    .on_click(cx.listener(|this, _, _, cx| this.apply_mongo_query(cx))),
            )
            .child(
                Button::new("mongo-reset", "Reset")
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .on_click(cx.listener(|this, _, _, cx| this.reset_mongo_query(cx))),
            )
            .child(
                Button::icon("mongo-refresh", IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .tooltip("Refresh")
                    .on_click(cx.listener(|this, _, _, cx| this.refresh_mongo(cx))),
            );

        let centered = |content: AnyElement| div().flex().flex_1().items_center().justify_center().child(content).into_any_element();
        let body = if mongo.loading && mongo.documents.is_empty() {
            centered(div().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("Loading…").into_any_element())
        } else if mongo.collection.is_none() {
            centered(
                EmptyState::new("Select a collection")
                    .icon(IconName::Stack)
                    .message("Choose a collection from the sidebar to browse documents.")
                    .into_any_element(),
            )
        } else if mongo.documents.is_empty() {
            centered(
                EmptyState::new("No documents found")
                    .icon(IconName::BracketsCurly)
                    .message("The current filter returned an empty result set.")
                    .into_any_element(),
            )
        } else {
            let (page, page_size) = (mongo.page, mongo.page_size);
            let cards: Vec<AnyElement> = mongo
                .documents
                .iter()
                .enumerate()
                .map(|(ix, document)| {
                    let group = SharedString::from(format!("mongo-document-{ix}"));
                    let deletable = document.get("_id").is_some();
                    div()
                        .group(group.clone())
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .py(px(10.))
                        .border_b_1()
                        .border_color(colors.divider)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .h(px(22.))
                                .gap(px(8.))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .truncate()
                                        .text_size(typography::TEXT_SM)
                                        .text_color(colors.subtle_foreground)
                                        .child(format!("Document {}", nosql::document_number(page, page_size, ix))),
                                )
                                .when(deletable, |this| {
                                    this.child(
                                        div().invisible().group_hover(group, |style| style.visible()).child(
                                            Button::icon(("delete-document", ix), IconName::Trash)
                                                .size(ButtonSize::XSmall)
                                                .tone(ui::ButtonTone::Danger)
                                                .tooltip("Delete document")
                                                .on_click(cx.listener(move |this, _, _, cx| this.request_delete_document(ix, cx))),
                                        ),
                                    )
                                }),
                        )
                        .child(code_block(&nosql::document_text(document), cx))
                        .into_any_element()
                })
                .collect();
            div()
                .id("mongo-documents")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .px(px(12.))
                .pb(px(12.))
                .children(cards)
                .scrollbar(window, cx)
                .into_any_element()
        };

        let pages = mongo.page_count();
        let (page, size, total) = (mongo.page, mongo.page_size, mongo.total);
        let footer = Self::footer(cx)
            .child(format!("{} {}", format::format_count(total), if total == 1 { "document" } else { "documents" }))
            .children(mongo.elapsed.map(|elapsed| format!("· {}", format::format_elapsed(elapsed))))
            .when(mongo.filter_json != "{}", |this| this.child("· filtered"))
            .children(mongo.collection.clone().map(|collection| format!("· {collection}")))
            .child(div().flex_1())
            .child(
                Button::new("mongo-page-size", format!("{size} per page"))
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::XSmall)
                    .trailing_icon(IconName::ChevronDown)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let entries = MONGO_PAGE_SIZES
                            .iter()
                            .map(|option| {
                                let option = *option;
                                this.item(format!("{option} documents"), cx, move |this, _, cx| this.set_mongo_page_size(option, cx))
                                    .checked(option == size)
                                    .into()
                            })
                            .collect();
                        this.show_menu("mongo-page-size", entries, window, cx);
                    })),
            )
            .child(pager("mongo", page, pages, cx, |this, page, cx| this.set_mongo_page(page, cx)));

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .child(toolbar)
            .children(mongo.error.as_ref().map(|error| Self::error_banner(error, cx)))
            .child(body)
            .child(footer)
            .into_any_element()
    }
}

/// Text in a monospace block, as the viewers show JSON.
pub(crate) fn code_block(text: &str, cx: &App) -> gpui::Div {
    let colors = &cx.theme().colors;
    div()
        .flex()
        .flex_col()
        .p(px(10.))
        .rounded(metrics::RADIUS_LG)
        .bg(colors.field)
        .font_family(typography::MONO_FONT)
        .text_size(typography::TEXT_CAPTION)
        .text_color(colors.foreground)
        .children(text.lines().map(|line| div().min_h(px(16.)).child(SharedString::from(line.replace('\t', "    ")))).collect::<Vec<_>>())
}

/// First, previous, "Page n of m", next and last.
pub(crate) fn pager(
    key: &'static str,
    page: usize,
    pages: usize,
    cx: &mut Context<DatabaseView>,
    go: impl Fn(&mut DatabaseView, usize, &mut Context<DatabaseView>) + Copy + 'static,
) -> gpui::Div {
    div()
        .flex()
        .items_center()
        .gap(px(6.))
        .child(
            Button::icon(SharedString::from(format!("{key}-first-page")), IconName::ChevronDoubleLeft)
                .size(ButtonSize::XSmall)
                .disabled(page == 0)
                .tooltip("First page")
                .on_click(cx.listener(move |this, _, _, cx| go(this, 0, cx))),
        )
        .child(
            Button::icon(SharedString::from(format!("{key}-previous-page")), IconName::ChevronLeft)
                .size(ButtonSize::XSmall)
                .disabled(page == 0)
                .tooltip("Previous page")
                .on_click(cx.listener(move |this, _, _, cx| go(this, page.saturating_sub(1), cx))),
        )
        .child(format!("Page {} of {}", format::format_count(page as u64 + 1), format::format_count(pages as u64)))
        .child(
            Button::icon(SharedString::from(format!("{key}-next-page")), IconName::ChevronRight)
                .size(ButtonSize::XSmall)
                .disabled(page + 1 >= pages)
                .tooltip("Next page")
                .on_click(cx.listener(move |this, _, _, cx| go(this, page + 1, cx))),
        )
        .child(
            Button::icon(SharedString::from(format!("{key}-last-page")), IconName::ChevronDoubleRight)
                .size(ButtonSize::XSmall)
                .disabled(page + 1 >= pages)
                .tooltip("Last page")
                .on_click(cx.listener(move |this, _, _, cx| go(this, pages.saturating_sub(1), cx))),
        )
}
