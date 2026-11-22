//! The bar above an editor (`editor/components/toolbar/breadcrumb.tsx`): the file's path under
//! the project, then the symbols the caret is in (`breadcrumbShowSymbols`).

use std::path::PathBuf;

use editor::{Editor, LspEvent};
use ui::scale::px;
use gpui::{AnyElement, Context, Entity, Focusable as _, IntoElement, Render, SharedString, Subscription, Task, Window, div, prelude::*,};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, PathBreadcrumb, typography};

use crate::{REFRESH_DELAY, Symbol, kind_icon, symbol_at_line, symbols_from_response};

/// The symbols from the outermost to the innermost one holding `line` (0-based).
pub fn symbol_chain(symbols: &[Symbol], line: u32) -> Vec<&Symbol> {
    let mut chain = Vec::new();
    let mut level = symbols;
    for index in symbol_at_line(symbols, line).unwrap_or_default() {
        let symbol = &level[index];
        chain.push(symbol);
        level = &symbol.children;
    }
    chain
}

pub struct Breadcrumbs {
    editor: Entity<Editor>,
    root: Option<PathBuf>,
    symbols: Vec<Symbol>,
    show_symbols: bool,
    refresh: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl Breadcrumbs {
    pub fn new(editor: Entity<Editor>, root: Option<PathBuf>, cx: &mut Context<Self>) -> Self {
        let subscriptions = vec![
            cx.subscribe(&editor, |this, _, event: &LspEvent, cx| {
                if *event == LspEvent::SymbolsChanged {
                    this.schedule_refresh(true, cx);
                }
            }),
            cx.observe(&editor, |_, _, cx| cx.notify()),
            cx.observe_global::<settings::SettingsStore>(|this, cx| {
                let show = settings::get(cx).breadcrumb_show_symbols;
                if show != this.show_symbols {
                    this.show_symbols = show;
                    this.schedule_refresh(false, cx);
                    cx.notify();
                }
            }),
        ];
        let mut this = Self {
            editor,
            root,
            symbols: Vec::new(),
            show_symbols: settings::get(cx).breadcrumb_show_symbols,
            refresh: None,
            _subscriptions: subscriptions,
        };
        this.schedule_refresh(false, cx);
        this
    }

    pub fn editor(&self) -> &Entity<Editor> {
        &self.editor
    }

    pub fn set_root(&mut self, root: Option<PathBuf>) {
        self.root = root;
    }

    fn schedule_refresh(&mut self, debounce: bool, cx: &mut Context<Self>) {
        if !self.show_symbols {
            self.refresh = None;
            self.symbols.clear();
            return;
        }
        let editor = self.editor.clone();
        self.refresh = Some(cx.spawn(async move |this, cx| {
            if debounce {
                cx.background_executor().timer(REFRESH_DELAY).await;
            }
            let Some(request) = editor.update(cx, |editor, _| editor.request_document_symbols()) else { return };
            let response = request.await.ok().flatten();
            this.update(cx, |this, cx| {
                this.symbols = response.map(symbols_from_response).unwrap_or_default();
                cx.notify();
            })
            .ok();
        }));
    }

    fn relative_path(&self, cx: &gpui::App) -> String {
        let path = self.editor.read(cx).path();
        let relative = self.root.as_deref().and_then(|root| path.strip_prefix(root).ok()).unwrap_or(path);
        relative.to_string_lossy().replace('\\', "/")
    }
}

impl Render for Breadcrumbs {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let path = self.relative_path(cx);
        let line = self.editor.read(cx).cursor_position().0.saturating_sub(1) as u32;
        let mut symbols: Vec<AnyElement> = Vec::new();
        if self.show_symbols {
            for (index, symbol) in symbol_chain(&self.symbols, line).into_iter().enumerate() {
                let (target_line, column) = (symbol.selection.line as usize + 1, symbol.selection.character as usize + 1);
                let editor = self.editor.clone();
                symbols.push(div().flex_none().child(Icon::new(IconName::ChevronRight).size(IconSize::XSmall).color(colors.subtle_foreground)).into_any_element());
                symbols.push(
                    div()
                        .id(("breadcrumb-symbol", index))
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(4.))
                        .h(px(20.))
                        .px(px(6.))
                        .rounded_full()
                        .whitespace_nowrap()
                        .text_color(colors.subtle_foreground)
                        .hover(|style| style.bg(colors.accent).text_color(colors.foreground))
                        .child(Icon::new(kind_icon(symbol.kind)).size(IconSize::XSmall).color(colors.subtle_foreground))
                        .child(SharedString::from(symbol.name.clone()))
                        .on_click(move |_, window, cx| {
                            editor.update(cx, |editor, cx| editor.go_to_line(target_line, Some(column), cx));
                            let handle = editor.read(cx).focus_handle(cx);
                            window.focus(&handle, cx);
                        })
                        .into_any_element(),
                );
            }
        }
        div()
            .id("editor-breadcrumbs")
            .flex()
            .flex_none()
            .items_center()
            .h(px(28.))
            .px(px(8.))
            .min_w_0()
            .overflow_hidden()
            .text_size(typography::text_sm())
            .child(PathBreadcrumb::from_path("editor-breadcrumb-path", &path))
            .children(symbols)
    }
}

#[cfg(test)]
mod tests {
    use lsp_client::lsp::{Position, SymbolKind};

    use super::*;

    fn symbol(name: &str, lines: (u32, u32), children: Vec<Symbol>) -> Symbol {
        Symbol { name: name.into(), detail: None, kind: SymbolKind::FUNCTION, lines, selection: Position::new(lines.0, 0), children }
    }

    #[test]
    fn the_chain_runs_from_the_outermost_symbol_in() {
        let symbols = vec![symbol("Editor", (0, 20), vec![symbol("new", (2, 5), vec![]), symbol("render", (8, 18), vec![])]), symbol("helper", (22, 30), vec![])];
        let names = |line| symbol_chain(&symbols, line).into_iter().map(|symbol| symbol.name.clone()).collect::<Vec<_>>();
        assert_eq!(names(10), vec!["Editor", "render"]);
        assert_eq!(names(6), vec!["Editor"]);
        assert_eq!(names(25), vec!["helper"]);
        assert!(names(21).is_empty());
    }
}
