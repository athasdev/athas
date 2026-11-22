//! The outline inside the command palette (`outline-command.tsx`): the active file's symbols as a
//! foldable list under "Outline: file", filtered as you type; picking one jumps there.

use std::{collections::HashSet, rc::Rc};

use editor::Editor;
use gpui::{AnyElement, App, Context, Entity, Focusable, SharedString, Task, Window, div, prelude::*, px};
use palette::{Picker, PickerDelegate};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, typography};

use crate::{Row, Symbol, kind_icon, symbols_from_response, visible_rows};

pub struct OutlinePickerDelegate {
    editor: Entity<Editor>,
    file_name: Option<String>,
    symbols: Vec<Symbol>,
    collapsed: HashSet<Vec<usize>>,
    query: String,
    rows: Vec<Row>,
    selected: usize,
    loading: bool,
    supported: bool,
    on_back: Rc<dyn Fn(&mut Window, &mut App)>,
    _load: Option<Task<()>>,
}

impl OutlinePickerDelegate {
    pub fn new(editor: Entity<Editor>, cx: &mut App, on_back: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        let file_name = editor.read(cx).path().file_name().map(|name| name.to_string_lossy().into_owned());
        let request = editor.update(cx, |editor, _| editor.request_document_symbols());
        Self {
            editor,
            file_name,
            symbols: Vec::new(),
            collapsed: HashSet::new(),
            query: String::new(),
            rows: Vec::new(),
            selected: 0,
            loading: request.is_some(),
            supported: request.is_some(),
            on_back: Rc::new(on_back),
            _load: None,
        }
    }

    /// Asks the language server for the symbols and fills the list when they arrive.
    pub fn load(&mut self, cx: &mut Context<Picker<Self>>) {
        let request = self.editor.update(cx, |editor, _| editor.request_document_symbols());
        let Some(request) = request else {
            self.loading = false;
            self.supported = false;
            return;
        };
        self._load = Some(cx.spawn(async move |picker, cx| {
            let response = request.await.ok();
            picker
                .update(cx, |picker, cx| {
                    let delegate = &mut picker.delegate;
                    delegate.loading = false;
                    delegate.supported = response.is_some();
                    delegate.symbols = response.flatten().map(symbols_from_response).unwrap_or_default();
                    delegate.refilter();
                    cx.notify();
                })
                .ok();
        }));
    }

    fn refilter(&mut self) {
        self.rows = visible_rows(&self.symbols, &self.collapsed, self.query.trim());
        self.selected = self.selected.min(self.rows.len().saturating_sub(1));
    }

    pub fn row_names(&self) -> Vec<String> {
        self.rows.iter().map(|row| row.symbol.name.clone()).collect()
    }
}

impl PickerDelegate for OutlinePickerDelegate {
    fn placeholder(&self) -> SharedString {
        match &self.file_name {
            Some(name) => format!("Outline: {name}").into(),
            None => "Outline".into(),
        }
    }

    fn match_count(&self) -> usize {
        self.rows.len()
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, _: &mut Context<Picker<Self>>) {
        self.selected = index;
    }

    fn leading_icon(&self) -> IconName {
        IconName::Sitemap
    }

    fn update_matches(&mut self, query: &str, _: &mut Window, _: &mut Context<Picker<Self>>) {
        self.query = query.to_string();
        self.selected = 0;
        self.refilter();
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, cx: &mut Context<Picker<Self>>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let row = &self.rows[index];
        let (text, muted) = if selected { (colors.primary_foreground, colors.primary_foreground.opacity(0.8)) } else { (colors.foreground, colors.subtle_foreground) };
        let collapsed = self.collapsed.contains(&row.path);
        let path = row.path.clone();
        div()
            .flex()
            .items_center()
            .gap(px(6.))
            .h(px(28.))
            .pl(px(8. + row.depth as f32 * 14.))
            .pr(px(10.))
            .rounded(ui::metrics::RADIUS_MD)
            .text_size(typography::TEXT_SM)
            .text_color(text)
            .when(selected, |this| this.bg(colors.primary))
            .child(
                div()
                    .id(("outline-command-toggle", index))
                    .flex_none()
                    .w(px(12.))
                    .when(row.has_children, |this| {
                        this.child(Icon::new(if collapsed { IconName::ChevronRight } else { IconName::ChevronDown }).size(IconSize::XSmall).color(muted)).on_click(cx.listener(move |picker, _, _, cx| {
                            cx.stop_propagation();
                            let delegate = &mut picker.delegate;
                            if !delegate.collapsed.remove(&path) {
                                delegate.collapsed.insert(path.clone());
                            }
                            delegate.refilter();
                            cx.notify();
                        }))
                    }),
            )
            .child(Icon::new(kind_icon(row.symbol.kind)).size(IconSize::XSmall).color(muted))
            .child(div().flex_none().max_w(px(320.)).truncate().child(row.symbol.name.clone()))
            .children(row.symbol.detail.clone().map(|detail| div().flex_1().min_w_0().truncate().text_size(typography::TEXT_CAPTION).text_color(muted).child(SharedString::from(detail))))
            .into_any_element()
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(row) = self.rows.get(index) else { return false };
        let selection = row.symbol.selection;
        let (line, column) = (selection.line as usize + 1, selection.character as usize + 1);
        self.editor.update(cx, |editor, cx| editor.go_to_line(line, Some(column), cx));
        let handle = self.editor.read(cx).focus_handle(cx);
        window.focus(&handle, cx);
        true
    }

    fn empty_message(&self) -> SharedString {
        if !self.supported {
            "No outline for the active file".into()
        } else if self.loading {
            "Loading outline...".into()
        } else {
            "No symbols found".into()
        }
    }

    fn leading_element(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        let colors = cx.theme().colors.clone();
        let on_back = self.on_back.clone();
        Some(
            div()
                .id("outline-command-back")
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(24.))
                .rounded_full()
                .hover(|style| style.bg(colors.accent))
                .child(Icon::new(IconName::ArrowLeft).size(IconSize::Small).color(colors.subtle_foreground))
                .on_click(cx.listener(move |picker, _, window, cx| {
                    picker.dismiss(window, cx);
                    on_back(window, cx);
                }))
                .into_any_element(),
        )
    }

    fn header_actions(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        vec![
            div()
                .flex_none()
                .px(px(6.))
                .rounded_full()
                .bg(colors.accent)
                .text_size(typography::TEXT_CAPTION)
                .text_color(colors.muted_foreground)
                .child(if self.loading { "...".to_string() } else { self.rows.len().to_string() })
                .into_any_element(),
        ]
    }
}
