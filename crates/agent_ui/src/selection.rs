//! Text selected across the transcript with the mouse, the way the browser gives it to Athas.
//!
//! GPUI draws messages as plain text elements, and those carry no selection of their own: the
//! session keeps one selection over the whole transcript instead, and every run of text it
//! draws colours the bytes the selection covers and moves the selection as the mouse drags
//! across it. The diff view does the same over its lines (`git_diff::selection`).

use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    ops::Range,
};

use gpui::{Context, Div, HighlightStyle, Hsla, KeyBinding, MouseButton, MouseDownEvent, MouseMoveEvent, Pixels, Point, SharedString, TextLayout, actions, prelude::*};

use ui::{Granularity, text_selection::unit_range};

use crate::session_view::SessionView;

actions!(agent, [CopyTranscriptSelection]);

pub(crate) fn bind_keys(cx: &mut gpui::App) {
    let mac = cfg!(target_os = "macos") || (cfg!(target_family = "wasm") && cx.platform_info().os == gpui::OperatingSystem::Mac);
    let copy = if mac { "cmd-c" } else { "ctrl-c" };
    cx.bind_keys([KeyBinding::new(copy, CopyTranscriptSelection, Some("AgentSession"))]);
}

/// Where a run of selectable text sits in the transcript: the entry it belongs to, then its
/// place inside that entry, deepest last. Paths sort in reading order, so a run knows whether
/// it falls between the selection's ends without asking anyone what else is drawn.
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SpanPath(Vec<u32>);

impl SpanPath {
    /// The root of an entry's runs.
    pub fn entry(index: usize) -> Self {
        Self(vec![index as u32])
    }

    /// The `part`th run (or group of runs) inside this one.
    pub fn child(&self, part: usize) -> Self {
        let mut path = self.0.clone();
        path.push(part as u32);
        Self(path)
    }

    fn entry_index(&self) -> usize {
        self.0.first().copied().unwrap_or_default() as usize
    }
}

/// Element ids are built from paths, which are unique within a transcript.
impl std::fmt::Display for SpanPath {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (index, part) in self.0.iter().enumerate() {
            if index > 0 {
                formatter.write_str("-")?;
            }
            write!(formatter, "{part}")?;
        }
        Ok(())
    }
}

/// A place in the transcript's text: a run and a byte offset in it.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TextPoint {
    pub span: SpanPath,
    pub offset: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextSelection {
    pub anchor: TextPoint,
    pub head: TextPoint,
    /// Whether the mouse is still down.
    pub selecting: bool,
    /// For a double or triple click, what it selects by and the unit it first took: the drag
    /// after it keeps that unit and grows by whole words or runs.
    pub unit: Option<(Granularity, TextPoint, TextPoint)>,
}

impl TextSelection {
    pub fn at(point: TextPoint) -> Self {
        Self { anchor: point.clone(), head: point, selecting: true, unit: None }
    }

    /// The `range` of the run at `span`, taken whole by a double or triple click.
    pub fn units(span: &SpanPath, range: Range<usize>, granularity: Granularity) -> Self {
        let start = TextPoint { span: span.clone(), offset: range.start };
        let end = TextPoint { span: span.clone(), offset: range.end };
        Self { anchor: start.clone(), head: end.clone(), selecting: true, unit: Some((granularity, start, end)) }
    }

    /// Moves the head to `point`; after a double or triple click, to the edge of the unit there,
    /// keeping the first unit selected.
    pub fn drag_to(&mut self, point: TextPoint, drawn: &DrawnRuns) {
        let Some((granularity, start, end)) = self.unit.clone() else {
            self.head = point;
            return;
        };
        let range = unit_at(drawn, &point.span, point.offset, granularity).unwrap_or(point.offset..point.offset);
        let here_start = TextPoint { span: point.span.clone(), offset: range.start };
        let here_end = TextPoint { span: point.span, offset: range.end };
        if here_start < start {
            self.anchor = end;
            self.head = here_start;
        } else {
            self.anchor = start;
            self.head = here_end.max(end);
        }
    }

    fn ordered(&self) -> (&TextPoint, &TextPoint) {
        if self.anchor <= self.head { (&self.anchor, &self.head) } else { (&self.head, &self.anchor) }
    }

    pub fn is_empty(&self) -> bool {
        self.anchor == self.head
    }

    /// The bytes selected in the run at `span`, `len` long: all of it when it lies between the
    /// selection's ends, and the part on the selected side when it holds one of them.
    pub fn range_in(&self, span: &SpanPath, len: usize) -> Option<Range<usize>> {
        if self.is_empty() {
            return None;
        }
        let (start, end) = self.ordered();
        if span < &start.span || span > &end.span {
            return None;
        }
        let from = if *span == start.span { start.offset.min(len) } else { 0 };
        let to = if *span == end.span { end.offset.min(len) } else { len };
        (from < to).then_some(from..to)
    }
}

/// The runs of text the transcript has drawn, by entry and then by place in it: what a copy of
/// the selection reads. Drawing an entry again replaces its runs, and entries the list has
/// never drawn have none — to reach one, the user has to scroll it past, which draws it.
pub type DrawnRuns = HashMap<usize, BTreeMap<SpanPath, SharedString>>;

/// What drawing a run of text needs to take part in the selection.
#[derive(Clone, Copy)]
pub struct Selecting<'a> {
    selection: Option<&'a TextSelection>,
    drawn: &'a RefCell<DrawnRuns>,
    color: Hsla,
}

impl<'a> Selecting<'a> {
    pub(crate) fn new(selection: Option<&'a TextSelection>, drawn: &'a RefCell<DrawnRuns>, color: Hsla) -> Self {
        Self { selection, drawn, color }
    }

    /// Notes `text` as the run drawn at `path` and returns the bytes of it the selection covers.
    fn run(&self, path: &SpanPath, text: &str) -> Option<Range<usize>> {
        self.drawn.borrow_mut().entry(path.entry_index()).or_default().insert(path.clone(), SharedString::from(text.to_string()));
        let range = self.selection?.range_in(path, text.len())?;
        let range = floor_char(text, range.start)..floor_char(text, range.end);
        (range.start < range.end).then_some(range)
    }

    /// `highlights` for `text` with the selected bytes given the selection's colour. The runs
    /// handed in have to be sorted and must not overlap, as `StyledText` needs them to be, and
    /// what comes back keeps that.
    pub fn highlights(&self, path: &SpanPath, text: &str, highlights: Vec<(Range<usize>, HighlightStyle)>) -> Vec<(Range<usize>, HighlightStyle)> {
        match self.run(path, text) {
            Some(range) => with_selection(highlights, range, self.color),
            None => highlights,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum SelectPhase {
    Start { extend: bool, clicks: usize },
    Drag,
}

/// Lets the text `layout` draws at `path` be selected: pressing starts a selection there (with
/// Shift, extends the one that is there), dragging moves its head, and a second or third click
/// takes the word or the whole run.
pub(crate) fn draggable(container: Div, path: SpanPath, layout: TextLayout, cx: &mut Context<SessionView>) -> Div {
    let (pressed, dragged) = (layout.clone(), layout);
    let drag_path = path.clone();
    container
        .cursor(gpui::CursorStyle::IBeam)
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                let offset = offset_at(&pressed, event.position);
                this.select_text(path.clone(), offset, SelectPhase::Start { extend: event.modifiers.shift, clicks: event.click_count }, cx);
            }),
        )
        .on_mouse_move(cx.listener(move |this, event: &MouseMoveEvent, _, cx| {
            if event.pressed_button != Some(MouseButton::Left) {
                return;
            }
            let offset = offset_at(&dragged, event.position);
            this.select_text(drag_path.clone(), offset, SelectPhase::Drag, cx);
        }))
        .on_mouse_down(
            MouseButton::Right,
            cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                this.deploy_transcript_menu(event.position, window, cx);
                cx.stop_propagation();
            }),
        )
}

/// The byte of the drawn text under `position`, or the nearest one when the mouse is past its
/// end. The layout is measured: a run only listens for the mouse once it has been drawn.
fn offset_at(layout: &TextLayout, position: Point<Pixels>) -> usize {
    layout.index_for_position(position).unwrap_or_else(|index| index)
}

/// The selected text, one line per run, as the transcript reads it out.
pub fn selected_text(drawn: &DrawnRuns, selection: &TextSelection) -> String {
    let (start, end) = selection.ordered();
    let mut lines: Vec<String> = Vec::new();
    for entry in start.span.entry_index()..=end.span.entry_index() {
        let Some(runs) = drawn.get(&entry) else { continue };
        for (path, text) in runs {
            let Some(range) = selection.range_in(path, text.len()) else { continue };
            let taken = &text[floor_char(text, range.start)..floor_char(text, range.end)];
            lines.push(taken.replace(crate::render::LINK_ICON_SPACE, ""));
        }
    }
    lines.join("\n")
}

/// The unit of `granularity` around `offset` in the run at `path`: a word, or the whole run for
/// a triple click.
pub(crate) fn unit_at(drawn: &DrawnRuns, path: &SpanPath, offset: usize, granularity: Granularity) -> Option<Range<usize>> {
    let text = drawn.get(&path.entry_index())?.get(path)?;
    Some(match granularity {
        Granularity::Line => 0..text.len(),
        granularity => unit_range(text, offset, granularity),
    })
}

/// `highlights` with `selected` coloured over them: the runs it covers keep their styling and
/// gain the selection's background, and the bytes no run covers become one of their own.
fn with_selection(highlights: Vec<(Range<usize>, HighlightStyle)>, selected: Range<usize>, color: Hsla) -> Vec<(Range<usize>, HighlightStyle)> {
    let background = HighlightStyle { background_color: Some(color), ..Default::default() };
    let mut out: Vec<(Range<usize>, HighlightStyle)> = Vec::new();
    // The first byte of the selection no run has covered yet.
    let mut bare = selected.start;
    for (range, style) in highlights {
        let gap = bare..range.start.clamp(bare, selected.end);
        if !gap.is_empty() {
            out.push((gap.clone(), background));
            bare = gap.end;
        }
        for piece in [range.start..range.end.min(selected.start), range.start.max(selected.start)..range.end.min(selected.end), range.start.max(selected.end)..range.end] {
            if piece.is_empty() {
                continue;
            }
            let inside = piece.start >= selected.start && piece.end <= selected.end;
            out.push((piece, if inside { HighlightStyle { background_color: Some(color), ..style } } else { style }));
        }
        bare = bare.max(range.end.min(selected.end));
    }
    if bare < selected.end {
        out.push((bare..selected.end, background));
    }
    out.sort_by_key(|(range, _)| range.start);
    out
}

fn floor_char(text: &str, mut offset: usize) -> usize {
    offset = offset.min(text.len());
    while !text.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(path: &[u32], offset: usize) -> TextPoint {
        TextPoint { span: SpanPath(path.to_vec()), offset }
    }

    fn runs_drawn(runs: &[(&[u32], &str)]) -> DrawnRuns {
        let mut drawn = DrawnRuns::new();
        for (path, text) in runs {
            let path = SpanPath(path.to_vec());
            drawn.entry(path.entry_index()).or_default().insert(path, SharedString::from(text.to_string()));
        }
        drawn
    }

    #[test]
    fn selections_cover_the_runs_between_their_ends() {
        let selection = TextSelection { anchor: point(&[1, 0], 6), head: point(&[3, 0, 2], 4), selecting: false, unit: None };
        assert_eq!(selection.range_in(&SpanPath(vec![1, 0]), 11), Some(6..11));
        assert_eq!(selection.range_in(&SpanPath(vec![2, 0]), 5), Some(0..5));
        assert_eq!(selection.range_in(&SpanPath(vec![3, 0, 2]), 9), Some(0..4));
        assert_eq!(selection.range_in(&SpanPath(vec![3, 0, 3]), 9), None);
        assert_eq!(selection.range_in(&SpanPath(vec![0, 0]), 9), None);
        // Backwards selections read the same.
        let backwards = TextSelection { anchor: selection.head.clone(), head: selection.anchor.clone(), selecting: false, unit: None };
        assert_eq!(backwards.range_in(&SpanPath(vec![2, 0]), 5), Some(0..5));
        assert!(TextSelection::at(point(&[1, 0], 6)).range_in(&SpanPath(vec![1, 0]), 11).is_none());
    }

    #[test]
    fn copying_reads_the_runs_the_selection_covers() {
        let drawn = runs_drawn(&[(&[1, 0], "hello world"), (&[2, 0], "first"), (&[2, 1], "second"), (&[3, 0], "last line")]);
        let selection = TextSelection { anchor: point(&[1, 0], 6), head: point(&[3, 0], 4), selecting: false, unit: None };
        assert_eq!(selected_text(&drawn, &selection), "world\nfirst\nsecond\nlast");
        // An entry the list has not drawn is skipped, not guessed at.
        let partial = runs_drawn(&[(&[1, 0], "hello world"), (&[3, 0], "last line")]);
        assert_eq!(selected_text(&partial, &selection), "world\nlast");
    }

    #[test]
    fn selection_colours_sit_over_the_styles_already_there() {
        let bold = HighlightStyle { font_weight: Some(gpui::FontWeight::BOLD), ..Default::default() };
        let color = gpui::red();
        // "plain **bold** plain", with the selection from inside the bold run to the end.
        let out = with_selection(vec![(6..10, bold)], 8..20, color);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], (6..8, bold));
        assert_eq!(out[1], (8..10, HighlightStyle { background_color: Some(color), ..bold }));
        assert_eq!(out[2], (10..20, HighlightStyle { background_color: Some(color), ..Default::default() }));
        // Ranges stay sorted and apart, as StyledText needs.
        assert!(out.windows(2).all(|pair| pair[0].0.end <= pair[1].0.start));
        // A selection before and after a styled run leaves it alone but still colours around it.
        let around = with_selection(vec![(6..10, bold)], 0..20, color);
        assert_eq!(around.iter().map(|(range, _)| range.clone()).collect::<Vec<_>>(), vec![0..6, 6..10, 10..20]);
        assert!(around.iter().all(|(_, style)| style.background_color == Some(color)));
        assert_eq!(with_selection(vec![(6..10, bold)], 0..3, color), vec![(0..3, HighlightStyle { background_color: Some(color), ..Default::default() }), (6..10, bold)]);
    }

    #[test]
    fn clicks_take_the_word_or_the_run_under_them() {
        let drawn = runs_drawn(&[(&[1, 0], "hello world"), (&[1, 1], "next run")]);
        assert_eq!(unit_at(&drawn, &SpanPath(vec![1, 0]), 7, Granularity::Word), Some(6..11));
        assert_eq!(unit_at(&drawn, &SpanPath(vec![1, 0]), 2, Granularity::Line), Some(0..11));
        assert_eq!(unit_at(&drawn, &SpanPath(vec![9, 0]), 0, Granularity::Word), None);
    }

    #[test]
    fn dragging_after_a_double_click_takes_whole_words_across_runs() {
        let drawn = runs_drawn(&[(&[1, 0], "hello world"), (&[1, 1], "next run")]);
        let mut selection = TextSelection::units(&SpanPath(vec![1, 0]), 6..11, Granularity::Word);
        // Into the next run: up to the end of the word there.
        selection.drag_to(point(&[1, 1], 1), &drawn);
        assert_eq!((selection.anchor.clone(), selection.head.clone()), (point(&[1, 0], 6), point(&[1, 1], 4)));
        // Back to the left: from the start of "hello" to the end of "world".
        selection.drag_to(point(&[1, 0], 2), &drawn);
        assert_eq!((selection.anchor.clone(), selection.head.clone()), (point(&[1, 0], 11), point(&[1, 0], 0)));
    }
}
