//! The cards language features float over the text: hover (with diagnostics), the completion
//! menu with its documentation, signature help, code actions and the rename field.

use std::ops::Range;

use gpui::{
    AnyElement, Anchor, Bounds, Context, Div, Font, FontStyle, FontWeight, Hsla, MouseButton, Pixels, SharedString, StyledText, TextRun,
    anchored, deferred, div, font, point, prelude::*, px, size,
};
use lsp_client::{Severity, lsp};
use theme::{ActiveTheme, Theme};
use ui::{Icon, IconName, IconSize, typography};

use crate::{
    Editor,
    lsp::{DiagnosticSpan, documentation_blocks},
    markdown::{Block, Inline},
};

const MENU_ROWS: usize = 10;
const MENU_ROW_HEIGHT: Pixels = px(24.);

pub(crate) fn severity_color(severity: Severity, theme: &Theme) -> Hsla {
    match severity {
        Severity::Error => theme.colors.destructive,
        Severity::Warning => theme.colors.warning,
        Severity::Info => theme.colors.info,
        Severity::Hint => theme.colors.subtle_foreground,
    }
}

fn severity_icon(severity: Severity) -> IconName {
    match severity {
        Severity::Error => IconName::WarningCircle,
        Severity::Warning => IconName::Warning,
        Severity::Info => IconName::Info,
        Severity::Hint => IconName::Lightbulb,
    }
}

fn completion_icon(kind: Option<lsp::CompletionItemKind>) -> IconName {
    use lsp::CompletionItemKind as Kind;
    match kind {
        Some(Kind::METHOD | Kind::FUNCTION | Kind::CONSTRUCTOR) => IconName::Function,
        Some(Kind::FIELD | Kind::PROPERTY | Kind::VARIABLE) => IconName::Cube,
        Some(Kind::CLASS | Kind::STRUCT | Kind::INTERFACE) => IconName::BracketsCurly,
        Some(Kind::MODULE) => IconName::Package,
        Some(Kind::KEYWORD) => IconName::Key,
        Some(Kind::SNIPPET) => IconName::CodeBlock,
        Some(Kind::ENUM | Kind::ENUM_MEMBER) => IconName::List,
        Some(Kind::CONSTANT | Kind::VALUE | Kind::UNIT) => IconName::Hash,
        Some(Kind::TYPE_PARAMETER) => IconName::Tag,
        Some(Kind::FILE) => IconName::File,
        Some(Kind::FOLDER) => IconName::Folder,
        Some(Kind::COLOR) => IconName::Palette,
        Some(Kind::REFERENCE) => IconName::Link,
        Some(Kind::EVENT) => IconName::Bolt,
        Some(Kind::OPERATOR) => IconName::Plus,
        _ => IconName::Text,
    }
}

/// Fonts and colors the cards draw text with.
struct TextStyle {
    ui: Font,
    mono: Font,
    foreground: Hsla,
    muted: Hsla,
    code_background: Hsla,
    link: Hsla,
}

impl TextStyle {
    fn new(cx: &gpui::App) -> Self {
        let colors = &cx.theme().colors;
        Self {
            ui: font(typography::UI_FONT),
            mono: font(SharedString::from(settings::get(cx).font_family.clone())),
            foreground: colors.foreground,
            muted: colors.muted_foreground,
            code_background: colors.field,
            link: colors.primary,
        }
    }

    fn run(&self, len: usize, font: &Font, color: Hsla) -> TextRun {
        TextRun { len, font: font.clone(), color, background_color: None, underline: None, strikethrough: None }
    }

    /// Runs for inline markdown: emphasis, code spans and links.
    fn inline(&self, inline: &Inline) -> StyledText {
        let mut runs = Vec::new();
        let mut at = 0;
        for (range, style) in &inline.spans {
            if range.start > at {
                runs.push(self.run(range.start - at, &self.ui, self.foreground));
            }
            let mut font = if style.code { self.mono.clone() } else { self.ui.clone() };
            if style.bold {
                font.weight = FontWeight::SEMIBOLD;
            }
            if style.italic {
                font.style = FontStyle::Italic;
            }
            let mut run = self.run(range.len(), &font, if style.link { self.link } else { self.foreground });
            if style.code {
                run.background_color = Some(self.code_background);
            }
            runs.push(run);
            at = range.end;
        }
        if at < inline.text.len() {
            runs.push(self.run(inline.text.len() - at, &self.ui, self.foreground));
        }
        StyledText::new(inline.text.clone()).with_runs(runs)
    }

    /// A code block highlighted with the editor's syntax table.
    fn code(&self, language: Option<&str>, code: &str, theme: &Theme) -> StyledText {
        StyledText::new(code.to_string()).with_runs(crate::markdown_preview::code_runs(language, code, &self.mono, self.foreground, theme))
    }

    fn blocks(&self, blocks: &[Block], theme: &Theme) -> Vec<AnyElement> {
        blocks
            .iter()
            .map(|block| match block {
                Block::Paragraph(text) => div().child(self.inline(text)).into_any_element(),
                Block::Heading(text) => div().font_weight(FontWeight::SEMIBOLD).child(self.inline(text)).into_any_element(),
                Block::Item { marker, text } => div()
                    .flex()
                    .gap(px(6.))
                    .child(div().flex_none().text_color(self.muted).child(marker.clone()))
                    .child(div().flex_1().min_w_0().child(self.inline(text)))
                    .into_any_element(),
                Block::Code { language, code } => div()
                    .px(px(8.))
                    .py(px(6.))
                    .rounded(ui::metrics::RADIUS_MD)
                    .bg(self.code_background)
                    .child(self.code(language.as_deref(), code, theme))
                    .into_any_element(),
                Block::Rule => div().h(px(1.)).bg(theme.colors.border).into_any_element(),
            })
            .collect()
    }
}

fn card(theme: &Theme) -> Div {
    div()
        .flex()
        .flex_col()
        .bg(theme.colors.overlay)
        .border_1()
        .border_color(theme.colors.border)
        .rounded(ui::metrics::RADIUS_LG)
        .shadow(theme.shadows.popover.clone())
        .text_size(typography::TEXT_SM)
        .text_color(theme.colors.foreground)
        .line_height(px(18.))
}

impl Editor {
    /// Where an offset is on screen (last frame), if visible.
    pub(crate) fn offset_bounds(&self, offset: usize) -> Option<Bounds<Pixels>> {
        let layout = self.layout.as_ref()?;
        let row = layout.row_holding(offset)?;
        if row.top + layout.line_height < layout.text_bounds.top() || row.top > layout.text_bounds.bottom() {
            return None;
        }
        let x = layout.origin.x + row.x_for(offset, layout.char_width);
        Some(Bounds::new(point(x, row.top), size(layout.char_width, layout.line_height)))
    }

    pub(crate) fn render_lsp_popovers(&mut self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let theme = cx.theme().clone();
        let style = TextStyle::new(cx);
        let mut popovers = Vec::new();
        if let Some(rename) = &self.lsp.rename
            && let Some(bounds) = self.offset_bounds(rename.range.start)
        {
            let field = card(&theme).w(px(260.)).h(px(30.)).px(px(10.)).justify_center().child(rename.input.clone());
            popovers.push(deferred(anchored().anchor(Anchor::TopLeft).attach(bounds, Anchor::BottomLeft).offset(point(px(0.), px(2.))).child(field)).with_priority(2).into_any_element());
            return popovers;
        }
        if let Some(menu) = self.render_completions(&style, &theme, cx) {
            popovers.push(menu);
        } else if let Some(menu) = self.render_code_actions(&theme, cx) {
            popovers.push(menu);
        }
        if let Some(signature) = self.render_signature(&style, &theme) {
            popovers.push(signature);
        }
        if let Some(hover) = self.render_hover(&style, &theme, cx) {
            popovers.push(hover);
        }
        popovers
    }

    fn render_hover(&self, style: &TextStyle, theme: &Theme, cx: &mut Context<Self>) -> Option<AnyElement> {
        let hover = self.lsp.hover.as_ref()?;
        let bounds = self.offset_bounds(hover.range.start)?;
        let mut content = card(theme).id("editor-hover").occlude().max_w(px(560.)).max_h(px(340.)).overflow_y_scroll().on_hover(cx.listener(|editor, hovered: &bool, _, cx| {
            editor.lsp.popover_hovered = *hovered;
            if !*hovered {
                cx.notify();
            }
        }));
        for diagnostic in &hover.diagnostics {
            content = content.child(diagnostic_row(diagnostic, theme));
        }
        if !hover.blocks.is_empty() {
            if !hover.diagnostics.is_empty() {
                content = content.child(div().h(px(1.)).bg(theme.colors.border));
            }
            content = content.child(div().flex().flex_col().gap(px(8.)).px(px(10.)).py(px(8.)).children(style.blocks(&hover.blocks, theme)));
        }
        Some(deferred(anchored().anchor(Anchor::BottomLeft).attach(bounds, Anchor::TopLeft).snap_to_window_with_margin(px(8.)).child(content)).with_priority(1).into_any_element())
    }

    fn render_completions(&self, style: &TextStyle, theme: &Theme, cx: &mut Context<Self>) -> Option<AnyElement> {
        let menu = self.lsp.completion.as_ref()?;
        let bounds = self.offset_bounds(menu.start)?;
        let colors = &theme.colors;
        let first = menu.selected.saturating_sub(MENU_ROWS - 1).min(menu.matches.len().saturating_sub(MENU_ROWS));
        let rows = menu.matches.iter().enumerate().skip(first).take(MENU_ROWS).map(|(position, index)| {
            let item = &menu.items[*index];
            let selected = position == menu.selected;
            let detail = item.label_details.as_ref().and_then(|details| details.description.clone().or(details.detail.clone())).or(item.detail.clone()).unwrap_or_default();
            div()
                .id(("completion", position))
                .flex()
                .items_center()
                .gap(px(8.))
                .h(MENU_ROW_HEIGHT)
                .px(px(8.))
                .rounded(ui::metrics::RADIUS_MD)
                .when(selected, |row| row.bg(colors.selected))
                .on_mouse_down(MouseButton::Left, cx.listener(move |editor, _, _, cx| {
                    cx.stop_propagation();
                    editor.confirm_completion(position, cx);
                }))
                // A path completion takes the icon theme's icon for the file it names.
                .child(match item.kind {
                    Some(lsp::CompletionItemKind::FILE) => extensions::file_icon(&item.label, px(12.), cx),
                    Some(lsp::CompletionItemKind::FOLDER) => extensions::entry_icon(&item.label, true, false, px(12.), cx),
                    _ => None,
                }
                .unwrap_or_else(|| Icon::new(completion_icon(item.kind)).size(IconSize::XSmall).color(colors.muted_foreground).into_any_element()))
                .child(
                    div()
                        .flex_none()
                        .max_w(px(260.))
                        .truncate()
                        .font(style.mono.clone())
                        .when(item.deprecated == Some(true), |label| label.line_through())
                        .child(item.label.clone()),
                )
                .child(div().flex_1().min_w_0().truncate().text_right().text_color(colors.subtle_foreground).child(detail.lines().next().unwrap_or_default().to_string()))
        });
        let list = card(theme).id("editor-completions").occlude().w(px(420.)).p(px(4.)).children(rows);
        let selected = menu.matches.get(menu.selected).map(|index| &menu.items[*index]);
        let docs = selected.and_then(|item| {
            let mut blocks = Vec::new();
            if let Some(detail) = &item.detail {
                blocks.push(Block::Code { language: self.lsp.document.as_ref().map(|document| document.language_id.clone()), code: detail.clone() });
            }
            if let Some(documentation) = &item.documentation {
                blocks.extend(documentation_blocks(documentation));
            }
            (!blocks.is_empty() && item.documentation.is_some()).then(|| {
                card(theme)
                    .id("editor-completion-docs")
                    .occlude()
                    .w(px(340.))
                    .max_h(px(MENU_ROWS as f32 * 24. + 8.))
                    .overflow_y_scroll()
                    .px(px(10.))
                    .py(px(8.))
                    .gap(px(6.))
                    .children(style.blocks(&blocks, theme))
            })
        });
        let menu = div().flex().items_start().gap(px(4.)).child(list).children(docs);
        Some(deferred(anchored().anchor(Anchor::TopLeft).attach(bounds, Anchor::BottomLeft).offset(point(px(-30.), px(2.))).child(menu)).with_priority(2).into_any_element())
    }

    fn render_code_actions(&self, theme: &Theme, cx: &mut Context<Self>) -> Option<AnyElement> {
        let menu = self.lsp.code_actions.as_ref()?;
        let bounds = self.offset_bounds(menu.anchor).or_else(|| self.offset_bounds(self.document.newest_selection().head))?;
        let colors = &theme.colors;
        let rows = menu.actions.iter().enumerate().map(|(index, action)| {
            let (title, kind) = match action {
                lsp::CodeActionOrCommand::Command(command) => (command.title.clone(), None),
                lsp::CodeActionOrCommand::CodeAction(action) => (action.title.clone(), action.kind.as_ref().map(|kind| kind.as_str().to_string())),
            };
            div()
                .id(("code-action", index))
                .flex()
                .items_center()
                .gap(px(8.))
                .h(MENU_ROW_HEIGHT)
                .px(px(8.))
                .rounded(ui::metrics::RADIUS_MD)
                .when(index == menu.selected, |row| row.bg(colors.selected))
                .on_mouse_down(MouseButton::Left, cx.listener(move |editor, _, window, cx| {
                    cx.stop_propagation();
                    editor.confirm_code_action(index, window, cx);
                }))
                .child(Icon::new(if kind.as_deref().is_some_and(|kind| kind.starts_with("quickfix")) { IconName::Lightbulb } else { IconName::Wrench }).size(IconSize::XSmall).color(colors.muted_foreground))
                .child(div().flex_1().min_w_0().truncate().child(title))
                .children(kind.map(|kind| div().flex_none().text_color(colors.subtle_foreground).text_size(typography::TEXT_CAPTION).child(kind)))
        });
        let list = card(theme).id("editor-code-actions").occlude().min_w(px(240.)).max_w(px(480.)).max_h(px(320.)).overflow_y_scroll().p(px(4.)).children(rows);
        Some(deferred(anchored().anchor(Anchor::TopLeft).attach(bounds, Anchor::BottomLeft).offset(point(px(0.), px(2.))).child(list)).with_priority(2).into_any_element())
    }

    fn render_signature(&self, style: &TextStyle, theme: &Theme) -> Option<AnyElement> {
        let help = self.lsp.signature.as_ref()?;
        let bounds = self.offset_bounds(self.document.newest_selection().head)?;
        let active = help.active_signature.unwrap_or(0) as usize;
        let signature = help.signatures.get(active).or(help.signatures.first())?;
        let parameter_index = signature.active_parameter.or(help.active_parameter).map(|index| index as usize);
        let parameter = parameter_index.and_then(|index| signature.parameters.as_ref()?.get(index));
        let highlight: Option<Range<usize>> = parameter.and_then(|parameter| match &parameter.label {
            lsp::ParameterLabel::Simple(text) => signature.label.find(text.as_str()).map(|start| start..start + text.len()),
            lsp::ParameterLabel::LabelOffsets([start, end]) => {
                let to_byte = |utf16: u32| {
                    let mut units = 0;
                    for (index, ch) in signature.label.char_indices() {
                        if units >= utf16 as usize {
                            return index;
                        }
                        units += ch.len_utf16();
                    }
                    signature.label.len()
                };
                Some(to_byte(*start)..to_byte(*end))
            }
        });
        let label_len = signature.label.len();
        let mut runs = Vec::new();
        match &highlight {
            Some(range) if range.end <= label_len && range.start < range.end => {
                if range.start > 0 {
                    runs.push(style.run(range.start, &style.mono, style.foreground));
                }
                let bold = Font { weight: FontWeight::BOLD, ..style.mono.clone() };
                runs.push(style.run(range.len(), &bold, theme.colors.primary));
                if range.end < label_len {
                    runs.push(style.run(label_len - range.end, &style.mono, style.foreground));
                }
            }
            _ => runs.push(style.run(label_len, &style.mono, style.foreground)),
        }
        let mut docs = Vec::new();
        if let Some(documentation) = parameter.and_then(|parameter| parameter.documentation.as_ref()) {
            docs.extend(documentation_blocks(documentation));
        }
        if let Some(documentation) = &signature.documentation {
            docs.extend(documentation_blocks(documentation).into_iter().take(3));
        }
        let counter = (help.signatures.len() > 1).then(|| format!("{}/{}", active + 1, help.signatures.len()));
        let content = card(theme)
            .id("editor-signature")
            .occlude()
            .max_w(px(560.))
            .max_h(px(220.))
            .overflow_y_scroll()
            .px(px(10.))
            .py(px(6.))
            .gap(px(6.))
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .children(counter.map(|counter| div().flex_none().text_color(theme.colors.subtle_foreground).child(counter)))
                    .child(div().min_w_0().child(StyledText::new(signature.label.clone()).with_runs(runs))),
            )
            .children(style.blocks(&docs, theme));
        Some(deferred(anchored().anchor(Anchor::BottomLeft).attach(bounds, Anchor::TopLeft).offset(point(px(0.), px(-2.))).child(content)).with_priority(1).into_any_element())
    }
}

fn diagnostic_row(diagnostic: &DiagnosticSpan, theme: &Theme) -> impl IntoElement + use<> {
    let color = severity_color(diagnostic.severity, theme);
    div()
        .flex()
        .gap(px(8.))
        .px(px(10.))
        .py(px(8.))
        .child(div().flex_none().pt(px(2.)).child(Icon::new(severity_icon(diagnostic.severity)).size(IconSize::XSmall).color(color)))
        .child(
            div()
                .flex()
                .flex_col()
                .min_w_0()
                .gap(px(2.))
                .child(div().whitespace_normal().child(diagnostic.message.clone()))
                .children(diagnostic.origin.clone().map(|origin| div().text_size(typography::TEXT_CAPTION).text_color(theme.colors.subtle_foreground).child(origin))),
        )
}
