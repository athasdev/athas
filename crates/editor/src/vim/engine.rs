//! The vim state machine, on a [`Document`] and without a window so every command can be tested:
//! modes, counts, registers, motions, operators, text objects, dot repeat, search and ex commands.

use std::collections::HashMap;

use regex::{Regex, RegexBuilder};

use crate::{
    buffer::Buffer,
    document::{Document, Target},
    history::EditKind,
    selection::Selection,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VimMode {
    Normal,
    Insert,
    Visual,
    VisualLine,
    VisualBlock,
    Replace,
}

impl VimMode {
    pub fn label(self) -> &'static str {
        match self {
            VimMode::Normal => "Normal",
            VimMode::Insert => "Insert",
            VimMode::Visual => "Visual",
            VimMode::VisualLine => "Visual Line",
            VimMode::VisualBlock => "Visual Block",
            VimMode::Replace => "Replace",
        }
    }

    pub fn is_visual(self) -> bool {
        matches!(self, VimMode::Visual | VimMode::VisualLine | VimMode::VisualBlock)
    }
}

/// A key as vim sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    Char(char),
    Escape,
    Enter,
    Backspace,
    /// A control chord: `Ctrl('r')`.
    Ctrl(char),
}

/// What the editor around the engine must do.
#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    Save,
    Close { force: bool },
    SaveAndClose,
    /// Open the command line for `:`, `/` or `?`.
    Prompt(char),
    /// Put this text on the system clipboard (the `+` and `*` registers).
    Clipboard(String),
    Fold(FoldCommand),
    Message(String),
    /// Run an Athas command by id (`:e` opens quick open, `:sb` toggles the sidebar).
    Command(&'static str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FoldCommand {
    Close,
    Open,
    Toggle,
    CloseAll,
    OpenAll,
}

/// What the engine reads from the editor for one key.
#[derive(Default)]
pub struct VimContext {
    /// Folded line ranges (inclusive), which `j` and `k` step over.
    pub hidden: Vec<(usize, usize)>,
    /// The system clipboard, for the `+` register.
    pub clipboard: Option<String>,
    /// Rows on screen, for ctrl-d and ctrl-u.
    pub page_rows: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Register {
    pub text: String,
    pub linewise: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    Delete,
    Change,
    Yank,
    Indent,
    Outdent,
    ToggleCase,
    Lowercase,
    Uppercase,
}

impl Op {
    fn from_char(ch: char) -> Option<Self> {
        Some(match ch {
            'd' => Op::Delete,
            'c' => Op::Change,
            'y' => Op::Yank,
            '>' => Op::Indent,
            '<' => Op::Outdent,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Motion {
    Left,
    Right,
    Down,
    Up,
    WordStart(bool),
    WordEnd(bool),
    WordBack(bool),
    LineStart,
    FirstNonBlank,
    LineEnd,
    FileStart,
    FileEnd,
    Find(char, char),
    RepeatFind(bool),
    MatchBracket,
    ParagraphForward,
    ParagraphBack,
    NextLine,
    PreviousLine,
    SearchNext(bool),
    HalfPage(bool),
    /// `'a` (to the line) or `` `a `` (to the spot).
    Mark { name: char, linewise: bool },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MotionKind {
    Exclusive,
    Inclusive,
    Linewise,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OpTarget {
    Motion(Motion),
    Object { around: bool, object: char },
    /// `dd`, `cc`, `yy`.
    Line,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    DeleteChar,
    DeleteCharBack,
    Substitute,
    SubstituteLine,
    DeleteToEnd,
    ChangeToEnd,
    YankLine,
    Paste(bool),
    ReplaceChar(char),
    Join,
    ToggleCaseChar,
    Undo,
    Redo,
    Insert,
    Append,
    InsertAtLineStart,
    AppendAtLineEnd,
    OpenBelow,
    OpenAbove,
    Visual,
    VisualLine,
    ReplaceMode,
    Repeat,
    Prompt(char),
    SearchWord(bool),
    Fold(FoldCommand),
    VisualSwap,
    VisualOp(Op),
    VisualObject { around: bool, object: char },
    VisualBlock,
    /// `O` in block visual mode: the other corner on the same line.
    VisualSwapColumns,
    /// `I` and `A` in block visual mode.
    BlockInsert(bool),
    Record(char),
    PlayMacro(char),
    SetMark(char),
    Escape,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Command {
    Motion { count: Option<usize>, motion: Motion },
    Operator { register: Option<char>, count: Option<usize>, op: Op, target: OpTarget },
    Action { register: Option<char>, count: Option<usize>, action: Action },
}

enum Parse {
    Incomplete,
    Invalid,
    Done(Command),
}

fn parse_count(keys: &[Key], at: &mut usize) -> Option<usize> {
    let mut count: Option<usize> = None;
    while let Some(Key::Char(ch)) = keys.get(*at) {
        let Some(digit) = ch.to_digit(10) else { break };
        if digit == 0 && count.is_none() {
            break;
        }
        count = Some(count.unwrap_or(0).saturating_mul(10).saturating_add(digit as usize));
        *at += 1;
    }
    count
}

/// A motion at `keys[at..]`, and how many keys it took.
fn parse_motion(keys: &[Key], at: usize) -> Result<Option<(Motion, usize)>, ()> {
    let Some(key) = keys.get(at) else { return Ok(None) };
    let motion = match key {
        Key::Char(ch) => match ch {
            'h' => Motion::Left,
            'l' | ' ' => Motion::Right,
            'j' => Motion::Down,
            'k' => Motion::Up,
            'w' => Motion::WordStart(false),
            'W' => Motion::WordStart(true),
            'e' => Motion::WordEnd(false),
            'E' => Motion::WordEnd(true),
            'b' => Motion::WordBack(false),
            'B' => Motion::WordBack(true),
            '0' => Motion::LineStart,
            '^' => Motion::FirstNonBlank,
            '$' => Motion::LineEnd,
            'G' => Motion::FileEnd,
            ';' => Motion::RepeatFind(false),
            ',' => Motion::RepeatFind(true),
            '%' => Motion::MatchBracket,
            '}' => Motion::ParagraphForward,
            '{' => Motion::ParagraphBack,
            '+' => Motion::NextLine,
            '-' => Motion::PreviousLine,
            'n' => Motion::SearchNext(false),
            'N' => Motion::SearchNext(true),
            'g' => {
                return match keys.get(at + 1) {
                    None => incomplete(),
                    Some(Key::Char('g')) => Ok(Some((Motion::FileStart, 2))),
                    Some(_) => Err(()),
                };
            }
            'f' | 't' | 'F' | 'T' => {
                return match keys.get(at + 1) {
                    None => incomplete(),
                    Some(Key::Char(target)) => Ok(Some((Motion::Find(*ch, *target), 2))),
                    Some(_) => Err(()),
                };
            }
            '\'' | '`' => {
                return match keys.get(at + 1) {
                    None => incomplete(),
                    Some(Key::Char(name)) => Ok(Some((Motion::Mark { name: *name, linewise: *ch == '\'' }, 2))),
                    Some(_) => Err(()),
                };
            }
            _ => return Err(()),
        },
        Key::Enter => Motion::NextLine,
        Key::Backspace => Motion::Left,
        Key::Ctrl('d') => Motion::HalfPage(true),
        Key::Ctrl('u') => Motion::HalfPage(false),
        _ => return Err(()),
    };
    Ok(Some((motion, 1)))
}

/// `parse_motion`'s "more keys needed".
fn incomplete() -> Result<Option<(Motion, usize)>, ()> {
    Ok(None)
}

fn parse(keys: &[Key], mode: VimMode) -> Parse {
    let visual = mode.is_visual();
    let block = mode == VimMode::VisualBlock;
    let mut at = 0;
    let mut register = None;
    if keys.first() == Some(&Key::Char('"')) {
        match keys.get(1) {
            None => return Parse::Incomplete,
            Some(Key::Char(name)) => register = Some(*name),
            Some(_) => return Parse::Invalid,
        }
        at = 2;
    }
    let count = parse_count(keys, &mut at);
    let Some(key) = keys.get(at) else { return Parse::Incomplete };
    let action = |action| Parse::Done(Command::Action { register, count, action });
    let operator = match key {
        Key::Char('g') => match keys.get(at + 1) {
            None => return Parse::Incomplete,
            Some(Key::Char('u')) => Some((Op::Lowercase, 2, 'u')),
            Some(Key::Char('U')) => Some((Op::Uppercase, 2, 'U')),
            Some(Key::Char('~')) => Some((Op::ToggleCase, 2, '~')),
            Some(_) => None,
        },
        Key::Char(ch) => Op::from_char(*ch).map(|op| (op, 1, *ch)),
        _ => None,
    };
    if let Some((op, len, ch)) = operator {
        if visual {
            return action(Action::VisualOp(op));
        }
        let mut after = at + len;
        let inner_count = parse_count(keys, &mut after);
        let count = match (count, inner_count) {
            (Some(a), Some(b)) => Some(a * b),
            (a, b) => a.or(b),
        };
        let target = match keys.get(after) {
            None => return Parse::Incomplete,
            Some(Key::Char(same)) if *same == ch => OpTarget::Line,
            Some(Key::Char('g')) if len == 2 && keys.get(after + 1) == Some(&Key::Char(ch)) => OpTarget::Line,
            Some(Key::Char(kind @ ('i' | 'a'))) => match keys.get(after + 1) {
                None => return Parse::Incomplete,
                Some(Key::Char(object)) => OpTarget::Object { around: *kind == 'a', object: *object },
                Some(_) => return Parse::Invalid,
            },
            Some(_) => match parse_motion(keys, after) {
                Ok(Some((motion, _))) => OpTarget::Motion(motion),
                Ok(None) => return Parse::Incomplete,
                Err(()) => return Parse::Invalid,
            },
        };
        return Parse::Done(Command::Operator { register, count, op, target });
    }
    match key {
        Key::Escape => return action(Action::Escape),
        Key::Ctrl('r') => return action(Action::Redo),
        Key::Ctrl('v') => return action(Action::VisualBlock),
        Key::Char(ch) => {
            if visual && (*ch == 'i' || *ch == 'a') {
                return match keys.get(at + 1) {
                    None => Parse::Incomplete,
                    Some(Key::Char(object)) => action(Action::VisualObject { around: *ch == 'a', object: *object }),
                    Some(_) => Parse::Invalid,
                };
            }
            let simple = match ch {
                'I' if block => Some(Action::BlockInsert(false)),
                'A' if block => Some(Action::BlockInsert(true)),
                'O' if block => Some(Action::VisualSwapColumns),
                'O' if visual => Some(Action::VisualSwap),
                'u' if visual => Some(Action::VisualOp(Op::Lowercase)),
                'U' if visual => Some(Action::VisualOp(Op::Uppercase)),
                'x' if visual => Some(Action::VisualOp(Op::Delete)),
                's' if visual => Some(Action::VisualOp(Op::Change)),
                '~' if visual => Some(Action::VisualOp(Op::ToggleCase)),
                'o' if visual => Some(Action::VisualSwap),
                'J' if visual => Some(Action::Join),
                'x' => Some(Action::DeleteChar),
                'X' => Some(Action::DeleteCharBack),
                's' => Some(Action::Substitute),
                'S' => Some(Action::SubstituteLine),
                'D' => Some(Action::DeleteToEnd),
                'C' => Some(Action::ChangeToEnd),
                'Y' => Some(Action::YankLine),
                'p' => Some(Action::Paste(true)),
                'P' => Some(Action::Paste(false)),
                'J' => Some(Action::Join),
                '~' => Some(Action::ToggleCaseChar),
                'u' => Some(Action::Undo),
                'i' => Some(Action::Insert),
                'a' => Some(Action::Append),
                'I' => Some(Action::InsertAtLineStart),
                'A' => Some(Action::AppendAtLineEnd),
                'o' => Some(Action::OpenBelow),
                'O' => Some(Action::OpenAbove),
                'v' => Some(Action::Visual),
                'V' => Some(Action::VisualLine),
                'R' => Some(Action::ReplaceMode),
                '.' => Some(Action::Repeat),
                ':' | '/' | '?' => Some(Action::Prompt(*ch)),
                '*' => Some(Action::SearchWord(true)),
                '#' => Some(Action::SearchWord(false)),
                _ => None,
            };
            if let Some(simple) = simple {
                return action(simple);
            }
            let with_char: Option<fn(char) -> Action> = match ch {
                'r' => Some(Action::ReplaceChar),
                'q' if !visual => Some(Action::Record),
                '@' if !visual => Some(Action::PlayMacro),
                'm' if !visual => Some(Action::SetMark),
                _ => None,
            };
            if let Some(make) = with_char {
                return match keys.get(at + 1) {
                    None => Parse::Incomplete,
                    Some(Key::Char(with)) => action(make(*with)),
                    Some(_) => Parse::Invalid,
                };
            }
            if *ch == 'z' {
                let fold = match keys.get(at + 1) {
                    None => return Parse::Incomplete,
                    Some(Key::Char('c')) => FoldCommand::Close,
                    Some(Key::Char('o')) => FoldCommand::Open,
                    Some(Key::Char('a')) => FoldCommand::Toggle,
                    Some(Key::Char('M')) => FoldCommand::CloseAll,
                    Some(Key::Char('R')) => FoldCommand::OpenAll,
                    Some(_) => return Parse::Invalid,
                };
                return action(Action::Fold(fold));
            }
        }
        _ => {}
    }
    match parse_motion(keys, at) {
        Ok(Some((motion, _))) => Parse::Done(Command::Motion { count, motion }),
        Ok(None) => Parse::Incomplete,
        Err(()) => Parse::Invalid,
    }
}

/// Vim's word classes: blank, word characters, other punctuation (`big` words: blank or not).
fn class(ch: Option<char>, big: bool) -> u8 {
    match ch {
        None => 0,
        Some(ch) if ch.is_whitespace() => 0,
        Some(_) if big => 1,
        Some(ch) if ch.is_alphanumeric() || ch == '_' => 1,
        Some(_) => 2,
    }
}

fn last_char(buffer: &Buffer, line: usize) -> usize {
    let (start, end) = (buffer.line_start(line), buffer.line_end(line));
    if end > start { buffer.previous_boundary(end) } else { start }
}

fn first_non_blank(buffer: &Buffer, line: usize) -> usize {
    buffer.line_start(line) + buffer.indent_len(line)
}

fn column_of(buffer: &Buffer, offset: usize) -> usize {
    let start = buffer.line_start(buffer.line_of(offset));
    buffer.slice(start..offset).chars().count()
}

fn at_column(buffer: &Buffer, line: usize, column: usize) -> usize {
    let start = buffer.line_start(line);
    let text = buffer.line(line);
    let byte = text.char_indices().nth(column).map(|(index, _)| index).unwrap_or(text.len());
    (start + byte).min(last_char(buffer, line))
}

/// The offset of character `column` on `line`, or the line's end when it is shorter.
fn char_offset(buffer: &Buffer, line: usize, column: usize) -> usize {
    let text = buffer.line(line);
    buffer.line_start(line) + text.char_indices().nth(column).map(|(index, _)| index).unwrap_or(text.len())
}

fn change_case(op: Op, text: &str) -> String {
    match op {
        Op::Lowercase => text.to_lowercase(),
        Op::Uppercase => text.to_uppercase(),
        _ => text.chars().map(toggle_case).collect(),
    }
}

fn is_empty_line(buffer: &Buffer, offset: usize) -> bool {
    buffer.char_at(offset) == Some('\n') && (offset == 0 || buffer.char_before(offset) == Some('\n'))
}

fn word_start_forward(buffer: &Buffer, from: usize, big: bool) -> usize {
    let len = buffer.len();
    let mut at = from;
    let start_class = class(buffer.char_at(at), big);
    if start_class != 0 {
        while at < len && class(buffer.char_at(at), big) == start_class {
            at = buffer.next_boundary(at);
        }
    }
    while at < len && class(buffer.char_at(at), big) == 0 {
        if buffer.char_at(at) == Some('\n') {
            at += 1;
            if is_empty_line(buffer, at) {
                return at;
            }
            continue;
        }
        at = buffer.next_boundary(at);
    }
    at
}

fn word_end_forward(buffer: &Buffer, from: usize, big: bool) -> usize {
    let len = buffer.len();
    let mut at = buffer.next_boundary(from);
    while at < len && class(buffer.char_at(at), big) == 0 {
        at = buffer.next_boundary(at);
    }
    let run = class(buffer.char_at(at), big);
    while at < len {
        let next = buffer.next_boundary(at);
        if next >= len || class(buffer.char_at(next), big) != run {
            break;
        }
        at = next;
    }
    at.min(len.saturating_sub(1))
}

fn word_start_back(buffer: &Buffer, from: usize, big: bool) -> usize {
    if from == 0 {
        return 0;
    }
    let mut at = buffer.previous_boundary(from);
    while at > 0 && class(buffer.char_at(at), big) == 0 {
        if is_empty_line(buffer, at) {
            return at;
        }
        at = buffer.previous_boundary(at);
    }
    let run = class(buffer.char_at(at), big);
    while at > 0 {
        let previous = buffer.previous_boundary(at);
        if class(buffer.char_at(previous), big) != run {
            break;
        }
        at = previous;
    }
    at
}

fn is_blank(buffer: &Buffer, line: usize) -> bool {
    buffer.is_blank_line(line)
}

/// The quote pair around (or after) `offset` on its line.
fn quote_range(buffer: &Buffer, offset: usize, quote: char) -> Option<(usize, usize)> {
    let line = buffer.line_of(offset);
    let start = buffer.line_start(line);
    let text = buffer.line(line);
    let mut quotes = Vec::new();
    let mut escaped = false;
    for (index, ch) in text.char_indices() {
        if ch == quote && !escaped {
            quotes.push(start + index);
        }
        escaped = ch == '\\' && !escaped;
    }
    let pairs: Vec<(usize, usize)> = quotes.chunks(2).filter(|pair| pair.len() == 2).map(|pair| (pair[0], pair[1])).collect();
    pairs.iter().find(|(open, close)| *open <= offset && offset <= *close).or_else(|| pairs.iter().find(|(open, _)| *open > offset)).copied()
}

/// The bracket pair of kind `open`/`close` around `offset`.
fn bracket_range(buffer: &Buffer, offset: usize, open: char, close: char) -> Option<(usize, usize)> {
    let opening = if buffer.char_at(offset) == Some(open) {
        offset
    } else {
        let mut depth = 0usize;
        let mut at = if buffer.char_at(offset) == Some(close) { offset } else { offset + buffer.char_at(offset).map(char::len_utf8).unwrap_or(0) };
        let mut found = None;
        for ch in buffer.reversed_chars_at(at).take(200_000) {
            at -= ch.len_utf8();
            if ch == close && at != offset {
                depth += 1;
            } else if ch == open {
                if depth == 0 {
                    found = Some(at);
                    break;
                }
                depth -= 1;
            }
        }
        found?
    };
    let mut depth = 0usize;
    let mut at = opening;
    for ch in buffer.chars_at(opening).take(200_000) {
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
            if depth == 0 {
                return Some((opening, at));
            }
        }
        at += ch.len_utf8();
    }
    None
}

fn bracket_pair(object: char) -> Option<(char, char)> {
    Some(match object {
        '(' | ')' | 'b' => ('(', ')'),
        '[' | ']' => ('[', ']'),
        '{' | '}' | 'B' => ('{', '}'),
        '<' | '>' => ('<', '>'),
        _ => return None,
    })
}

/// Converts a vim pattern to a Rust regex (the common escapes), case-insensitive with `\c`.
fn compile_pattern(pattern: &str) -> Option<Regex> {
    let (pattern, ignore_case) = match pattern.strip_prefix("\\c").or_else(|| pattern.strip_suffix("\\c")) {
        Some(rest) => (rest, true),
        None => (pattern, false),
    };
    let converted = pattern.replace("\\<", "\\b").replace("\\>", "\\b").replace("\\(", "(").replace("\\)", ")").replace("\\|", "|").replace("\\+", "+");
    RegexBuilder::new(&converted).case_insensitive(ignore_case).build().ok()
}

/// A vim replacement (`&`, `\1`) in the regex crate's syntax.
fn convert_replacement(replacement: &str) -> String {
    let mut out = String::new();
    let mut chars = replacement.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '$' => out.push_str("$$"),
            '&' => out.push_str("${0}"),
            '\\' => match chars.next() {
                Some(digit) if digit.is_ascii_digit() => out.push_str(&format!("${{{digit}}}")),
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            },
            other => out.push(other),
        }
    }
    out
}

/// Splits `s/pattern/replacement/flags` on unescaped slashes.
fn split_substitute(rest: &str) -> Option<(String, String, String)> {
    let mut chars = rest.chars();
    let delimiter = chars.next()?;
    let mut parts = vec![String::new()];
    let mut escaped = false;
    for ch in chars {
        if escaped {
            if ch != delimiter {
                parts.last_mut()?.push('\\');
            }
            parts.last_mut()?.push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == delimiter && parts.len() < 3 {
            parts.push(String::new());
        } else {
            parts.last_mut()?.push(ch);
        }
    }
    let mut parts = parts.into_iter();
    Some((parts.next()?, parts.next().unwrap_or_default(), parts.next().unwrap_or_default()))
}

pub struct Vim {
    pub mode: VimMode,
    pending: Vec<Key>,
    registers: HashMap<char, Register>,
    last_find: Option<(char, char)>,
    last_search: Option<(String, bool)>,
    /// Where visual mode started, and the caret in it.
    visual_anchor: usize,
    visual_head: usize,
    /// The column `j` and `k` aim for (`usize::MAX` after `$`).
    goal: Option<usize>,
    last_change: Vec<Key>,
    /// The keys of a change still being typed (an insert after `c`, `o`, `A`...).
    recording: Option<Vec<Key>>,
    replaying: bool,
    /// The line range of the last visual selection, for `:'<,'>`.
    last_visual_lines: Option<(usize, usize)>,
    /// `:set rnu` and `:set nornu`, over the setting.
    pub relative_numbers: Option<bool>,
    /// The last search's matches are highlighted until `:noh`.
    highlight_search: bool,
    search_regex: Option<Regex>,
    /// The macro being recorded (`qa`) and its keys so far.
    macro_recording: Option<(char, Vec<Key>)>,
    macros: HashMap<char, Vec<Key>>,
    last_macro: Option<char>,
    playing_macro: bool,
    /// `ma` marks, as (line, column).
    marks: HashMap<char, (usize, usize)>,
    /// Where the last jump started, for `''`.
    last_jump: Option<(usize, usize)>,
    /// Block visual mode reaches every line's end (after `$`).
    block_to_end: bool,
    /// The selections block visual mode last drew, to notice a mouse changing them.
    block_shown: Vec<std::ops::Range<usize>>,
}

impl Default for Vim {
    fn default() -> Self {
        Self {
            mode: VimMode::Normal,
            pending: Vec::new(),
            registers: HashMap::new(),
            last_find: None,
            last_search: None,
            visual_anchor: 0,
            visual_head: 0,
            goal: None,
            last_change: Vec::new(),
            recording: None,
            replaying: false,
            last_visual_lines: None,
            relative_numbers: None,
            highlight_search: false,
            search_regex: None,
            macro_recording: None,
            macros: HashMap::new(),
            last_macro: None,
            playing_macro: false,
            marks: HashMap::new(),
            last_jump: None,
            block_to_end: false,
            block_shown: Vec::new(),
        }
    }
}

impl Vim {
    /// The keys typed so far of an unfinished command, for the status bar.
    pub fn pending_keys(&self) -> String {
        self.pending
            .iter()
            .map(|key| match key {
                Key::Char(ch) => ch.to_string(),
                Key::Escape => "⎋".into(),
                Key::Enter => "↩".into(),
                Key::Backspace => "⌫".into(),
                Key::Ctrl(ch) => format!("^{ch}"),
            })
            .collect()
    }

    #[cfg(test)]
    pub fn register(&self, name: char) -> Option<&Register> {
        self.registers.get(&name)
    }

    /// The register a macro is being recorded into.
    pub fn recording_macro(&self) -> Option<char> {
        self.macro_recording.as_ref().map(|(name, _)| *name)
    }

    /// The last search, while its matches are highlighted.
    pub fn search_highlight(&self) -> Option<&Regex> {
        self.search_regex.as_ref().filter(|_| self.highlight_search)
    }

    fn set_search(&mut self, pattern: String, forward: bool) {
        self.search_regex = compile_pattern(&pattern);
        self.last_search = Some((pattern, forward));
        self.highlight_search = true;
    }

    fn remember_jump(&mut self, buffer: &Buffer, offset: usize) {
        self.last_jump = Some((buffer.line_of(offset), column_of(buffer, offset)));
    }

    /// The caret drawn in visual mode (the document's selection ends after it).
    pub fn visual_head(&self) -> Option<usize> {
        self.mode.is_visual().then_some(self.visual_head)
    }

    fn head(document: &Document) -> usize {
        document.newest_selection().head
    }

    /// Back to normal mode with the caret where the document has it (after a mouse click or a
    /// setting change).
    pub fn reset(&mut self, document: &mut Document) {
        self.pending.clear();
        self.recording = None;
        document.history.end_group();
        self.mode = VimMode::Normal;
        self.clamp(document);
    }

    /// Keeps normal mode's block caret on a character.
    pub fn clamp(&self, document: &mut Document) {
        if self.mode != VimMode::Normal {
            return;
        }
        let head = Self::head(document);
        let line = document.buffer.line_of(head);
        let last = last_char(&document.buffer, line);
        if head > last || document.selections.len() > 1 || !document.newest_selection().is_empty() {
            document.set_cursor(head.min(last));
        }
    }

    /// Something other than vim moved the selection (the mouse): follow it.
    pub fn sync(&mut self, document: &mut Document) {
        if self.mode == VimMode::VisualBlock {
            if document.selections.iter().map(Selection::range).eq(self.block_shown.iter().cloned()) {
                return;
            }
            self.mode = VimMode::Normal;
        }
        if self.mode.is_visual() {
            let (start, end) = self.visual_range(&document.buffer);
            let selection = document.newest_selection();
            if selection.range() != (start..end) {
                if selection.is_empty() {
                    self.mode = VimMode::Normal;
                } else {
                    self.visual_anchor = selection.anchor.min(document.buffer.len());
                    self.visual_head = if selection.head > selection.anchor { document.buffer.previous_boundary(selection.head) } else { selection.head };
                    self.show_visual(document);
                }
            }
        }
        if self.mode == VimMode::Normal && !document.newest_selection().is_empty() {
            // A mouse selection starts visual mode, as in Vim.
            let selection = document.newest_selection().clone();
            self.mode = VimMode::Visual;
            self.visual_anchor = selection.anchor;
            self.visual_head = if selection.head > selection.anchor { document.buffer.previous_boundary(selection.head) } else { selection.head };
            self.show_visual(document);
        }
    }

    /// Text typed in insert mode, for dot repeat.
    pub fn record_typed(&mut self, text: &str) {
        for ch in text.chars() {
            self.record_key(if ch == '\n' { Key::Enter } else { Key::Char(ch) });
        }
    }

    pub fn record_key(&mut self, key: Key) {
        self.record_change(key);
        self.record_macro(key);
    }

    fn record_change(&mut self, key: Key) {
        if let Some(recording) = &mut self.recording {
            recording.push(key);
        }
    }

    fn record_macro(&mut self, key: Key) {
        if !self.playing_macro
            && !self.replaying
            && let Some((_, keys)) = &mut self.macro_recording
        {
            keys.push(key);
        }
    }

    /// Handles one key in normal, visual or replace mode (and escape in insert mode).
    pub fn handle(&mut self, key: Key, document: &mut Document, context: &VimContext) -> Vec<Effect> {
        let mut effects = Vec::new();
        if key == Key::Char('q') && self.pending.is_empty() && !matches!(self.mode, VimMode::Insert | VimMode::Replace) && !self.playing_macro && !self.replaying {
            if let Some((name, keys)) = self.macro_recording.take() {
                if name.is_ascii_uppercase() {
                    self.macros.entry(name.to_ascii_lowercase()).or_default().extend(keys);
                } else {
                    self.macros.insert(name, keys);
                }
                return effects;
            }
        }
        self.record_macro(key);
        match self.mode {
            VimMode::Insert => {
                if self.replaying || self.playing_macro {
                    match key {
                        Key::Char(ch) => document.insert(&ch.to_string()),
                        Key::Enter => document.newline(),
                        Key::Backspace => document.backspace(),
                        _ => {}
                    }
                    if !self.replaying && key != Key::Escape {
                        self.record_change(key);
                    }
                }
                if key == Key::Escape {
                    self.finish_insert(document);
                }
                return effects;
            }
            VimMode::Replace => {
                self.record_change(key);
                match key {
                    Key::Escape => self.finish_insert(document),
                    Key::Char(ch) => {
                        let head = Self::head(document);
                        let end = if document.buffer.char_at(head).is_some_and(|next| next != '\n') { document.buffer.next_boundary(head) } else { head };
                        let text = ch.to_string();
                        document.apply_edits(vec![(head..end, text.clone())], vec![Target::Exact { anchor: head + text.len(), head: head + text.len() }], EditKind::Insert);
                    }
                    Key::Backspace | Key::Ctrl('h') => {
                        let head = Self::head(document);
                        document.set_cursor(document.buffer.previous_boundary(head));
                    }
                    Key::Enter => document.newline(),
                    _ => {}
                }
                return effects;
            }
            _ => {}
        }
        self.pending.push(key);
        let command = match parse(&self.pending, self.mode) {
            Parse::Incomplete => return effects,
            Parse::Invalid => {
                self.pending.clear();
                return effects;
            }
            Parse::Done(command) => command,
        };
        let keys = std::mem::take(&mut self.pending);
        let version = document.buffer.version();
        let repeatable = !matches!(
            command,
            Command::Motion { .. }
                | Command::Action {
                    action: Action::Repeat
                        | Action::Undo
                        | Action::Redo
                        | Action::Prompt(_)
                        | Action::Visual
                        | Action::VisualLine
                        | Action::VisualBlock
                        | Action::VisualSwap
                        | Action::VisualSwapColumns
                        | Action::Escape
                        | Action::Fold(_)
                        | Action::SearchWord(_)
                        | Action::Record(_)
                        | Action::PlayMacro(_)
                        | Action::SetMark(_),
                    ..
                }
                | Command::Operator { op: Op::Yank, .. }
        );
        let group = repeatable && !self.replaying;
        let block = self.mode == VimMode::VisualBlock;
        if group {
            document.history.begin_group();
        }
        self.execute(command, document, context, &mut effects);
        if matches!(self.mode, VimMode::Insert | VimMode::Replace) {
            if !self.replaying && !block {
                self.recording = Some(keys);
            }
        } else {
            if group {
                document.history.end_group();
                if document.buffer.version() != version && !block {
                    self.last_change = keys;
                }
            }
            self.clamp(document);
        }
        effects
    }

    fn finish_insert(&mut self, document: &mut Document) {
        if let Some(mut recording) = self.recording.take() {
            recording.push(Key::Escape);
            self.last_change = recording;
        }
        document.history.end_group();
        self.mode = VimMode::Normal;
        // Leaving insert mode steps back onto the character before the caret.
        let head = Self::head(document);
        let line_start = document.buffer.line_start(document.buffer.line_of(head));
        let head = if head > line_start { document.buffer.previous_boundary(head) } else { head };
        document.set_cursor(head);
        self.clamp(document);
    }

    fn enter_insert(&mut self, document: &mut Document, at: usize) {
        document.set_cursor(at);
        self.mode = VimMode::Insert;
    }

    fn visual_range(&self, buffer: &Buffer) -> (usize, usize) {
        let (low, high) = (self.visual_anchor.min(self.visual_head), self.visual_anchor.max(self.visual_head));
        if self.mode == VimMode::VisualLine {
            let last = buffer.line_of(high);
            let end = if last + 1 < buffer.line_count() { buffer.line_start(last + 1) } else { buffer.len() };
            (buffer.line_start(buffer.line_of(low)), end)
        } else {
            (low, buffer.next_boundary(high).max(low).min(buffer.len()))
        }
    }

    /// Block visual mode's lines and columns: first line, last line, first column, and the
    /// column after the last (`usize::MAX` after `$`).
    fn block_bounds(&self, buffer: &Buffer) -> (usize, usize, usize, usize) {
        let (anchor_line, head_line) = (buffer.line_of(self.visual_anchor), buffer.line_of(self.visual_head));
        let anchor_column = column_of(buffer, self.visual_anchor);
        let head_column = match self.goal {
            Some(goal) if goal != usize::MAX => goal,
            _ => column_of(buffer, self.visual_head),
        };
        let end = if self.block_to_end { usize::MAX } else { anchor_column.max(head_column) + 1 };
        (anchor_line.min(head_line), anchor_line.max(head_line), anchor_column.min(head_column), end)
    }

    /// The piece of each line the block covers; lines too short to reach it have none.
    fn block_ranges(&self, buffer: &Buffer) -> Vec<(usize, std::ops::Range<usize>)> {
        let (first, last, start, end) = self.block_bounds(buffer);
        (first..=last)
            .filter_map(|line| {
                let chars = buffer.line(line).chars().count();
                (chars > start).then(|| (line, char_offset(buffer, line, start)..char_offset(buffer, line, end.min(chars))))
            })
            .collect()
    }

    /// Selections at `offsets`, the first of them the newest, so the view and a later escape
    /// follow the top line.
    fn set_block_carets(document: &mut Document, offsets: impl IntoIterator<Item = std::ops::Range<usize>>, reversed: bool) {
        let mut selections: Vec<Selection> = offsets
            .into_iter()
            .map(|range| {
                let mut selection = Selection::cursor(0, 0);
                selection.set_range(range, reversed);
                selection
            })
            .collect();
        for selection in selections.iter_mut().rev() {
            selection.id = document.new_selection_id();
        }
        document.set_selections(selections);
    }

    fn show_visual(&mut self, document: &mut Document) {
        if self.mode == VimMode::VisualBlock {
            let buffer = document.buffer.clone();
            let head_line = buffer.line_of(self.visual_head);
            let mut ranges = self.block_ranges(&buffer);
            if ranges.is_empty() {
                ranges.push((head_line, self.visual_head..self.visual_head));
            }
            let reversed = column_of(&buffer, self.visual_head) < column_of(&buffer, self.visual_anchor);
            let mut selections: Vec<Selection> = ranges
                .iter()
                .map(|(_, range)| {
                    let mut selection = Selection::cursor(0, 0);
                    selection.set_range(range.clone(), reversed);
                    selection
                })
                .collect();
            let head_index = ranges.iter().position(|(line, _)| *line == head_line).unwrap_or(0);
            for (index, selection) in selections.iter_mut().enumerate() {
                if index != head_index {
                    selection.id = document.new_selection_id();
                }
            }
            selections[head_index].id = document.new_selection_id();
            document.set_selections(selections);
            self.block_shown = document.selections.iter().map(Selection::range).collect();
            let (first, last, _, _) = self.block_bounds(&buffer);
            self.last_visual_lines = Some((first, last));
            return;
        }
        let (start, end) = self.visual_range(&document.buffer);
        let id = document.new_selection_id();
        let mut selection = Selection::cursor(id, 0);
        selection.set_range(start..end, self.visual_head < self.visual_anchor);
        document.set_selections(vec![selection]);
        let lines = (document.buffer.line_of(start), document.buffer.line_of(end.saturating_sub(1).max(start)));
        self.last_visual_lines = Some(lines);
    }

    fn write_register(&mut self, name: Option<char>, text: String, linewise: bool, yank: bool, effects: &mut Vec<Effect>) {
        let register = Register { text, linewise };
        match name {
            Some('_') => return,
            Some(upper) if upper.is_ascii_uppercase() => {
                let entry = self.registers.entry(upper.to_ascii_lowercase()).or_default();
                entry.text.push_str(&register.text);
                entry.linewise |= register.linewise;
            }
            Some('+' | '*') => effects.push(Effect::Clipboard(register.text.clone())),
            Some(name) => {
                self.registers.insert(name, register.clone());
            }
            None => {}
        }
        if yank {
            self.registers.insert('0', register.clone());
        }
        self.registers.insert('"', register);
    }

    fn read_register(&self, name: Option<char>, context: &VimContext) -> Option<Register> {
        match name {
            Some('+' | '*') => context.clipboard.clone().map(|text| Register { linewise: text.ends_with('\n'), text }),
            Some(name) => self.registers.get(&name.to_ascii_lowercase()).cloned(),
            None => self.registers.get(&'"').cloned(),
        }
    }

    /// The line `count` visible lines below (or above) `line`, stepping over folds.
    fn step_lines(buffer: &Buffer, hidden: &[(usize, usize)], line: usize, count: usize, down: bool) -> usize {
        let last = buffer.line_count().saturating_sub(1);
        let mut line = line;
        for _ in 0..count {
            let next = if down {
                if line >= last {
                    break;
                }
                let mut next = line + 1;
                if let Some((_, end)) = hidden.iter().find(|(start, end)| (*start..=*end).contains(&next)) {
                    next = end + 1;
                }
                if next > last {
                    break;
                }
                next
            } else {
                if line == 0 {
                    break;
                }
                let mut next = line - 1;
                if let Some((start, _)) = hidden.iter().find(|(start, end)| (*start..=*end).contains(&next)) {
                    next = start.saturating_sub(1);
                }
                next
            };
            line = next;
        }
        line
    }

    /// Where `motion` goes from `from`, and how an operator takes the text up to it.
    fn motion_target(&mut self, motion: Motion, count: Option<usize>, from: usize, buffer: &Buffer, context: &VimContext, operator: bool) -> Option<(usize, MotionKind)> {
        let times = count.unwrap_or(1).max(1);
        let line = buffer.line_of(from);
        let vertical = matches!(motion, Motion::Up | Motion::Down | Motion::HalfPage(_));
        if !vertical {
            self.goal = None;
        }
        let result = match motion {
            Motion::Left => {
                let start = buffer.line_start(line);
                let mut at = from;
                for _ in 0..times {
                    if at > start {
                        at = buffer.previous_boundary(at);
                    }
                }
                (at, MotionKind::Exclusive)
            }
            Motion::Right => {
                let end = buffer.line_end(line);
                let mut at = from;
                for _ in 0..times {
                    if at < end {
                        at = buffer.next_boundary(at);
                    }
                }
                if !operator {
                    at = at.min(last_char(buffer, line));
                }
                (at, MotionKind::Exclusive)
            }
            Motion::Down | Motion::Up | Motion::HalfPage(_) => {
                let (rows, down) = match motion {
                    Motion::HalfPage(down) => ((context.page_rows / 2).max(1) * times, down),
                    Motion::Down => (times, true),
                    _ => (times, false),
                };
                let goal = *self.goal.get_or_insert_with(|| column_of(buffer, from));
                let target = Self::step_lines(buffer, &context.hidden, line, rows, down);
                if target == line && operator && !matches!(motion, Motion::HalfPage(_)) {
                    return None;
                }
                let at = if goal == usize::MAX { last_char(buffer, target) } else { at_column(buffer, target, goal) };
                (at, MotionKind::Linewise)
            }
            Motion::WordStart(big) => {
                let mut at = from;
                for index in 0..times {
                    let next = word_start_forward(buffer, at, big);
                    // `dw` on the last word of a line stops at the line end.
                    if operator && index + 1 == times && buffer.line_of(next) > buffer.line_of(at) {
                        at = buffer.line_end(buffer.line_of(at)).max(at);
                        break;
                    }
                    at = next;
                }
                (at, MotionKind::Exclusive)
            }
            Motion::WordEnd(big) => {
                let mut at = from;
                for _ in 0..times {
                    at = word_end_forward(buffer, at, big);
                }
                (at, MotionKind::Inclusive)
            }
            Motion::WordBack(big) => {
                let mut at = from;
                for _ in 0..times {
                    at = word_start_back(buffer, at, big);
                }
                (at, MotionKind::Exclusive)
            }
            Motion::LineStart => (buffer.line_start(line), MotionKind::Exclusive),
            Motion::FirstNonBlank => (first_non_blank(buffer, line), MotionKind::Exclusive),
            Motion::LineEnd => {
                self.goal = Some(usize::MAX);
                let target = (line + times - 1).min(buffer.line_count() - 1);
                let at = if operator { buffer.line_end(target) } else { last_char(buffer, target) };
                (at, if operator { MotionKind::Exclusive } else { MotionKind::Inclusive })
            }
            Motion::FileStart | Motion::FileEnd => {
                let last = buffer.line_count() - 1;
                let target = match (count, motion) {
                    (Some(count), _) => (count - 1).min(last),
                    (None, Motion::FileStart) => 0,
                    _ => last,
                };
                (first_non_blank(buffer, target), MotionKind::Linewise)
            }
            Motion::Find(kind, target) => {
                self.last_find = Some((kind, target));
                (Self::find_in_line(buffer, from, kind, target, times)?, if kind.is_ascii_lowercase() { MotionKind::Inclusive } else { MotionKind::Exclusive })
            }
            Motion::RepeatFind(reverse) => {
                let (kind, target) = self.last_find?;
                let kind = if reverse {
                    match kind {
                        'f' => 'F',
                        'F' => 'f',
                        't' => 'T',
                        _ => 't',
                    }
                } else {
                    kind
                };
                // `;` after `t` must not stop on the same spot.
                let start = match kind {
                    't' => buffer.next_boundary(from),
                    'T' => buffer.previous_boundary(from),
                    _ => from,
                };
                (Self::find_in_line(buffer, start, kind, target, times)?, if kind.is_ascii_lowercase() { MotionKind::Inclusive } else { MotionKind::Exclusive })
            }
            Motion::MatchBracket => {
                let end = buffer.line_end(line);
                let mut at = from;
                while at < end && !buffer.char_at(at).is_some_and(|ch| "()[]{}".contains(ch)) {
                    at = buffer.next_boundary(at);
                }
                let ch = buffer.char_at(at)?;
                let (open, close) = bracket_pair(ch)?;
                let (start, finish) = bracket_range(buffer, at, open, close)?;
                (if at == start { finish } else { start }, MotionKind::Inclusive)
            }
            Motion::ParagraphForward => {
                let last = buffer.line_count() - 1;
                let mut target = line;
                for _ in 0..times {
                    target += 1;
                    while target < last && is_blank(buffer, target) {
                        target += 1;
                    }
                    while target < last && !is_blank(buffer, target) {
                        target += 1;
                    }
                }
                let target = target.min(last);
                (if target == last && !is_blank(buffer, target) { last_char(buffer, target) } else { buffer.line_start(target) }, MotionKind::Exclusive)
            }
            Motion::ParagraphBack => {
                let mut target = line;
                for _ in 0..times {
                    target = target.saturating_sub(1);
                    while target > 0 && is_blank(buffer, target) {
                        target -= 1;
                    }
                    while target > 0 && !is_blank(buffer, target) {
                        target -= 1;
                    }
                }
                (buffer.line_start(target), MotionKind::Exclusive)
            }
            Motion::NextLine | Motion::PreviousLine => {
                let target = Self::step_lines(buffer, &context.hidden, line, times, motion == Motion::NextLine);
                (first_non_blank(buffer, target), MotionKind::Linewise)
            }
            Motion::Mark { name, linewise } => {
                let (line, column) = match name {
                    '\'' | '`' => self.last_jump?,
                    name => *self.marks.get(&name)?,
                };
                let line = line.min(buffer.line_count() - 1);
                if linewise { (first_non_blank(buffer, line), MotionKind::Linewise) } else { (at_column(buffer, line, column), MotionKind::Exclusive) }
            }
            Motion::SearchNext(reverse) => {
                let (pattern, forward) = self.last_search.clone()?;
                self.highlight_search = true;
                let mut at = from;
                for _ in 0..times {
                    at = Self::search_from(buffer, &pattern, at, forward != reverse)?;
                }
                (at, MotionKind::Exclusive)
            }
        };
        Some(result)
    }

    fn find_in_line(buffer: &Buffer, from: usize, kind: char, target: char, times: usize) -> Option<usize> {
        let line = buffer.line_of(from);
        let (start, end) = (buffer.line_start(line), buffer.line_end(line));
        let mut at = from;
        for _ in 0..times {
            if kind == 'f' || kind == 't' {
                let mut probe = buffer.next_boundary(at);
                while buffer.char_at(probe) != Some(target) {
                    if probe >= end {
                        return None;
                    }
                    probe = buffer.next_boundary(probe);
                }
                if probe >= end {
                    return None;
                }
                at = probe;
            } else {
                let mut probe = at;
                loop {
                    if probe <= start {
                        return None;
                    }
                    probe = buffer.previous_boundary(probe);
                    if buffer.char_at(probe) == Some(target) {
                        break;
                    }
                }
                at = probe;
            }
        }
        Some(match kind {
            't' => buffer.previous_boundary(at),
            'T' => buffer.next_boundary(at),
            _ => at,
        })
    }

    /// The next match of `pattern` after (or before) `from`, wrapping around.
    fn search_from(buffer: &Buffer, pattern: &str, from: usize, forward: bool) -> Option<usize> {
        let regex = compile_pattern(pattern)?;
        let text = buffer.text();
        let starts: Vec<usize> = regex.find_iter(&text).map(|found| found.start()).collect();
        if forward {
            starts.iter().find(|start| **start > from).or(starts.first()).copied()
        } else {
            starts.iter().rev().find(|start| **start < from).or(starts.last()).copied()
        }
    }

    /// The range a text object covers around `offset`, and whether it is whole lines.
    fn object_range(buffer: &Buffer, offset: usize, around: bool, object: char) -> Option<(usize, usize, bool)> {
        match object {
            'w' | 'W' => {
                let big = object == 'W';
                let line = buffer.line_of(offset);
                let (line_start, line_end) = (buffer.line_start(line), buffer.line_end(line));
                let run = class(buffer.char_at(offset), big);
                let mut start = offset;
                while start > line_start && class(buffer.char_before(start), big) == run {
                    start = buffer.previous_boundary(start);
                }
                let mut end = offset;
                while end < line_end && class(buffer.char_at(end), big) == run {
                    end = buffer.next_boundary(end);
                }
                if around {
                    if end < line_end && class(buffer.char_at(end), big) == 0 {
                        while end < line_end && class(buffer.char_at(end), big) == 0 {
                            end = buffer.next_boundary(end);
                        }
                    } else {
                        while start > line_start && class(buffer.char_before(start), big) == 0 {
                            start = buffer.previous_boundary(start);
                        }
                    }
                }
                Some((start, end, false))
            }
            '"' | '\'' | '`' => {
                let (open, close) = quote_range(buffer, offset, object)?;
                Some(if around { (open, close + 1, false) } else { (open + 1, close, false) })
            }
            'p' => {
                let line = buffer.line_of(offset);
                let blank = is_blank(buffer, line);
                let last = buffer.line_count() - 1;
                let mut first = line;
                while first > 0 && is_blank(buffer, first - 1) == blank {
                    first -= 1;
                }
                let mut end = line;
                while end < last && is_blank(buffer, end + 1) == blank {
                    end += 1;
                }
                if around {
                    while end < last && is_blank(buffer, end + 1) != blank {
                        end += 1;
                    }
                }
                Some((buffer.line_start(first), buffer.line_start(end), true))
            }
            other => {
                let (open, close) = bracket_pair(other)?;
                let (start, end) = bracket_range(buffer, offset, open, close)?;
                Some(if around { (start, end + 1, false) } else { (start + 1, end, false) })
            }
        }
    }

    fn execute(&mut self, command: Command, document: &mut Document, context: &VimContext, effects: &mut Vec<Effect>) {
        let head = if self.mode.is_visual() { self.visual_head } else { Self::head(document) };
        match command {
            Command::Motion { count, motion } => {
                let buffer = document.buffer.clone();
                let Some((target, _)) = self.motion_target(motion, count, head, &buffer, context, false) else { return };
                if matches!(motion, Motion::FileStart | Motion::FileEnd | Motion::MatchBracket | Motion::ParagraphForward | Motion::ParagraphBack | Motion::SearchNext(_) | Motion::Mark { .. }) {
                    self.remember_jump(&buffer, head);
                }
                if self.mode == VimMode::VisualBlock {
                    self.block_to_end = motion == Motion::LineEnd || (self.block_to_end && matches!(motion, Motion::Up | Motion::Down | Motion::HalfPage(_)));
                }
                if self.mode.is_visual() {
                    self.visual_head = target;
                    self.show_visual(document);
                } else {
                    let goal = self.goal;
                    document.set_cursor(target);
                    self.goal = goal;
                }
            }
            Command::Operator { register, count, op, target } => {
                let buffer = document.buffer.clone();
                let range = match target {
                    OpTarget::Line => {
                        let line = buffer.line_of(head);
                        let last = (line + count.unwrap_or(1) - 1).min(buffer.line_count() - 1);
                        Some((buffer.line_start(line), buffer.line_start(last), true))
                    }
                    OpTarget::Object { around, object } => Self::object_range(&buffer, head, around, object),
                    OpTarget::Motion(motion) => {
                        // `cw` changes to the end of the word, as `ce` does.
                        let motion = match motion {
                            Motion::WordStart(big) if op == Op::Change && class(buffer.char_at(head), big) != 0 => Motion::WordEnd(big),
                            motion => motion,
                        };
                        let from = if matches!(motion, Motion::WordEnd(_)) && op == Op::Change {
                            // `ce` on the last character of a word changes just that character.
                            let next = buffer.next_boundary(head);
                            if class(buffer.char_at(next), false) != class(buffer.char_at(head), false) { buffer.previous_boundary(head).min(head) } else { head }
                        } else {
                            head
                        };
                        self.motion_target(motion, count, from, &buffer, context, true).map(|(target, kind)| match kind {
                            MotionKind::Linewise => (head.min(target), head.max(target), true),
                            MotionKind::Inclusive => {
                                let (low, high) = (head.min(target), head.max(target));
                                (low, buffer.next_boundary(high).min(buffer.len()), false)
                            }
                            MotionKind::Exclusive => (head.min(target), head.max(target), false),
                        })
                    }
                };
                let Some((start, end, linewise)) = range else { return };
                self.apply_operator(op, register, start, end, linewise, document, effects);
            }
            Command::Action { register, count, action } => self.action(action, register, count, head, document, context, effects),
        }
    }

    /// Runs `op` on `start..end`; with `linewise`, on the whole lines from `start`'s to `end`'s.
    #[allow(clippy::too_many_arguments)]
    fn apply_operator(&mut self, op: Op, register: Option<char>, start: usize, end: usize, linewise: bool, document: &mut Document, effects: &mut Vec<Effect>) {
        let buffer = document.buffer.clone();
        let (range, text) = if linewise {
            let first = buffer.line_of(start);
            let last = buffer.line_of(end).max(first);
            let range_end = if last + 1 < buffer.line_count() { buffer.line_start(last + 1) } else { buffer.len() };
            let range = buffer.line_start(first)..range_end;
            let mut text = buffer.slice(range.clone());
            if !text.ends_with('\n') {
                text.push('\n');
            }
            (range, text)
        } else {
            (start..end, buffer.slice(start..end))
        };
        let first_line = buffer.line_of(range.start);
        match op {
            Op::Yank => {
                self.write_register(register, text, linewise, true, effects);
                // `yy` and `yj` leave the caret; anything reaching back moves it to the start.
                let head = document.newest_selection().head;
                let keep = linewise && !self.mode.is_visual() && buffer.line_of(head) == first_line;
                document.set_cursor(if keep { head } else { start });
            }
            Op::Delete => {
                self.write_register(register, text, linewise, false, effects);
                let mut range = range;
                // Deleting the last lines takes the newline before them instead.
                let took_previous = linewise && range.end == buffer.len() && range.start > 0 && !buffer.slice(range.clone()).ends_with('\n');
                if took_previous {
                    range.start -= 1;
                }
                document.apply_edits(vec![(range.clone(), String::new())], vec![Target::Exact { anchor: range.start, head: range.start }], EditKind::Other);
                if linewise {
                    let line = if took_previous { first_line - 1 } else { first_line.min(document.buffer.line_count() - 1) };
                    document.set_cursor(first_non_blank(&document.buffer, line));
                }
                self.mode = VimMode::Normal;
            }
            Op::Change => {
                self.write_register(register, text, linewise, false, effects);
                if linewise {
                    // Keep one line, with the first line's indent.
                    let indent: String = buffer.line(first_line).chars().take_while(|ch| *ch == ' ' || *ch == '\t').collect();
                    let mut range = range;
                    if range.end > range.start && buffer.char_before(range.end) == Some('\n') {
                        range.end -= 1;
                    }
                    let caret = range.start + indent.len();
                    document.apply_edits(vec![(range, indent)], vec![Target::Exact { anchor: caret, head: caret }], EditKind::Other);
                } else {
                    document.apply_edits(vec![(range.clone(), String::new())], vec![Target::Exact { anchor: range.start, head: range.start }], EditKind::Other);
                }
                self.mode = VimMode::Insert;
            }
            Op::Indent | Op::Outdent => {
                let last = buffer.line_of(range.end.saturating_sub(1).max(range.start));
                document.select_range(buffer.line_start(first_line)..buffer.line_end(last));
                document.indent_lines(op == Op::Outdent);
                document.set_cursor(first_non_blank(&document.buffer, first_line));
                self.mode = VimMode::Normal;
            }
            Op::ToggleCase | Op::Lowercase | Op::Uppercase => {
                let changed = change_case(op, &buffer.slice(range.clone()));
                // `guu` and `gUj` leave the caret; anything else goes to the start.
                let head = document.newest_selection().head;
                let caret = if linewise && !self.mode.is_visual() && head >= range.start {
                    // The same character as before: `ı` → `I` shortens the text ahead of it.
                    let before = buffer.slice(range.start..head.min(range.end)).chars().count();
                    range.start + changed.char_indices().nth(before).map_or(changed.len(), |(offset, _)| offset)
                } else {
                    range.start
                };
                document.apply_edits(vec![(range.clone(), changed)], vec![Target::Exact { anchor: caret, head: caret }], EditKind::Other);
                self.mode = VimMode::Normal;
            }
        }
        if op == Op::Yank {
            self.mode = VimMode::Normal;
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn action(&mut self, action: Action, register: Option<char>, count: Option<usize>, head: usize, document: &mut Document, context: &VimContext, effects: &mut Vec<Effect>) {
        let times = count.unwrap_or(1).max(1);
        let buffer = document.buffer.clone();
        let line = buffer.line_of(head);
        let operate = |vim: &mut Vim, document: &mut Document, effects: &mut Vec<Effect>, op: Op, motion: Motion| {
            vim.execute(Command::Operator { register, count, op, target: OpTarget::Motion(motion) }, document, context, effects);
        };
        match action {
            Action::Escape => {
                if self.mode.is_visual() {
                    self.mode = VimMode::Normal;
                    document.set_cursor(self.visual_head);
                }
            }
            Action::DeleteChar => {
                if buffer.line_end(line) > buffer.line_start(line) {
                    operate(self, document, effects, Op::Delete, Motion::Right);
                }
            }
            Action::DeleteCharBack => operate(self, document, effects, Op::Delete, Motion::Left),
            Action::Substitute => {
                if buffer.line_end(line) > buffer.line_start(line) {
                    operate(self, document, effects, Op::Change, Motion::Right);
                } else {
                    self.mode = VimMode::Insert;
                }
            }
            Action::SubstituteLine => self.execute(Command::Operator { register, count, op: Op::Change, target: OpTarget::Line }, document, context, effects),
            Action::DeleteToEnd => operate(self, document, effects, Op::Delete, Motion::LineEnd),
            Action::ChangeToEnd => operate(self, document, effects, Op::Change, Motion::LineEnd),
            Action::YankLine => self.execute(Command::Operator { register, count, op: Op::Yank, target: OpTarget::Line }, document, context, effects),
            Action::Paste(after) => self.paste(register, times, after, head, document, context, effects),
            Action::ReplaceChar(with) if self.mode.is_visual() => {
                let ranges: Vec<std::ops::Range<usize>> = if self.mode == VimMode::VisualBlock {
                    self.block_ranges(&buffer).into_iter().map(|(_, range)| range).collect()
                } else {
                    let (start, end) = self.visual_range(&buffer);
                    vec![start..end]
                };
                let start = ranges.first().map(|range| range.start).unwrap_or(head);
                let edits = ranges
                    .into_iter()
                    .map(|range| {
                        let text: String = buffer.slice(range.clone()).chars().map(|ch| if ch == '\n' { ch } else { with }).collect();
                        (range, text)
                    })
                    .collect();
                document.apply_edits(edits, vec![Target::Exact { anchor: start, head: start }], EditKind::Other);
                self.mode = VimMode::Normal;
            }
            Action::ReplaceChar(with) => {
                let end_of_line = buffer.line_end(line);
                let mut end = head;
                for _ in 0..times {
                    if end >= end_of_line {
                        return;
                    }
                    end = buffer.next_boundary(end);
                }
                let text: String = std::iter::repeat_n(with, times).collect();
                let caret = head + text.len() - with.len_utf8();
                document.apply_edits(vec![(head..end, text)], vec![Target::Exact { anchor: caret, head: caret }], EditKind::Other);
            }
            Action::Join => {
                let (first, last) = if self.mode.is_visual() {
                    let (start, end) = self.visual_range(&buffer);
                    (buffer.line_of(start), buffer.line_of(end.saturating_sub(1)).max(buffer.line_of(start) + 1))
                } else {
                    (line, line + times.max(2) - 1)
                };
                let last = last.min(buffer.line_count() - 1);
                let mut edits = Vec::new();
                let mut caret = head;
                for joined in first + 1..=last {
                    let end_of_previous = buffer.line_end(joined - 1);
                    let next_text = buffer.line(joined);
                    let indent = next_text.len() - next_text.trim_start().len();
                    let separator = if next_text.trim().is_empty() || next_text.trim_start().starts_with(')') || buffer.line(joined - 1).ends_with(' ') { "" } else { " " };
                    edits.push((end_of_previous..buffer.line_start(joined) + indent, separator.to_string()));
                    caret = end_of_previous;
                }
                if edits.is_empty() {
                    return;
                }
                let shift: isize = edits.iter().take(edits.len() - 1).map(|(range, text): &(std::ops::Range<usize>, String)| text.len() as isize - range.len() as isize).sum();
                let caret = (caret as isize + shift) as usize;
                document.apply_edits(edits, vec![Target::Exact { anchor: caret, head: caret }], EditKind::Other);
                self.mode = VimMode::Normal;
            }
            Action::ToggleCaseChar => {
                let end_of_line = buffer.line_end(line);
                let mut end = head;
                for _ in 0..times {
                    if end < end_of_line {
                        end = buffer.next_boundary(end);
                    }
                }
                if end > head {
                    let toggled: String = buffer.slice(head..end).chars().map(toggle_case).collect();
                    // `ı` → `I` and similar change the byte length: the caret follows the new text.
                    let after = head + toggled.len();
                    document.apply_edits(vec![(head..end, toggled)], vec![Target::Exact { anchor: after, head: after }], EditKind::Other);
                }
            }
            Action::Undo | Action::Redo => {
                for _ in 0..times {
                    let done = if action == Action::Undo { document.undo() } else { document.redo() };
                    if !done {
                        effects.push(Effect::Message(if action == Action::Undo { "Already at oldest change" } else { "Already at newest change" }.into()));
                        break;
                    }
                }
                let start = document.newest_selection().start();
                document.set_cursor(start);
            }
            Action::Insert => self.enter_insert(document, head),
            Action::Append => {
                let at = if buffer.char_at(head).is_some_and(|ch| ch != '\n') { buffer.next_boundary(head) } else { head };
                self.enter_insert(document, at);
            }
            Action::InsertAtLineStart => self.enter_insert(document, first_non_blank(&buffer, line)),
            Action::AppendAtLineEnd => self.enter_insert(document, buffer.line_end(line)),
            Action::OpenBelow | Action::OpenAbove => {
                document.set_cursor(head);
                document.newline_beside(action == Action::OpenAbove);
                self.mode = VimMode::Insert;
            }
            Action::Visual | Action::VisualLine | Action::VisualBlock => {
                let mode = match action {
                    Action::Visual => VimMode::Visual,
                    Action::VisualLine => VimMode::VisualLine,
                    _ => VimMode::VisualBlock,
                };
                if self.mode == mode {
                    self.mode = VimMode::Normal;
                    document.set_cursor(self.visual_head);
                } else {
                    if !self.mode.is_visual() {
                        self.visual_anchor = head;
                        self.visual_head = head;
                        self.goal = None;
                    }
                    self.block_to_end = false;
                    self.mode = mode;
                    self.show_visual(document);
                }
            }
            Action::VisualObject { around, object } => {
                let Some((start, end, linewise)) = Self::object_range(&buffer, head, around, object) else { return };
                self.visual_anchor = start;
                self.visual_head = if end > start { buffer.previous_boundary(end) } else { start };
                if linewise {
                    self.mode = VimMode::VisualLine;
                }
                self.show_visual(document);
            }
            Action::VisualSwap => {
                std::mem::swap(&mut self.visual_anchor, &mut self.visual_head);
                self.goal = None;
                self.show_visual(document);
            }
            Action::VisualSwapColumns => {
                let (anchor_line, head_line) = (buffer.line_of(self.visual_anchor), buffer.line_of(self.visual_head));
                let (anchor_column, head_column) = (column_of(&buffer, self.visual_anchor), column_of(&buffer, self.visual_head));
                self.visual_anchor = at_column(&buffer, anchor_line, head_column);
                self.visual_head = at_column(&buffer, head_line, anchor_column);
                self.goal = None;
                self.show_visual(document);
            }
            Action::VisualOp(op) if self.mode == VimMode::VisualBlock => self.block_operator(op, register, document, effects),
            Action::BlockInsert(append) => {
                let (first, last, start, end) = self.block_bounds(&buffer);
                let mut edits = Vec::new();
                let mut carets = Vec::new();
                for line in first..=last {
                    let chars = buffer.line(line).chars().count();
                    if append {
                        if end == usize::MAX {
                            carets.push(buffer.line_end(line));
                        } else if chars < end {
                            let at = buffer.line_end(line);
                            edits.push((at..at, " ".repeat(end - chars)));
                            carets.push(at);
                        } else {
                            carets.push(char_offset(&buffer, line, end));
                        }
                    } else if chars >= start {
                        carets.push(char_offset(&buffer, line, start));
                    }
                }
                if carets.is_empty() {
                    carets.push(self.visual_head);
                }
                let targets = carets.into_iter().map(|at| Target::Mapped { anchor: at, head: at }).collect();
                document.apply_edits(edits, targets, EditKind::Other);
                let carets: Vec<_> = document.selections.iter().map(Selection::range).collect();
                Self::set_block_carets(document, carets, false);
                self.mode = VimMode::Insert;
            }
            Action::Record(name) => {
                if name.is_ascii_alphanumeric() || name == '"' {
                    self.macro_recording = Some((name, Vec::new()));
                }
            }
            Action::PlayMacro(name) => {
                let Some(name) = (if name == '@' { self.last_macro } else { Some(name.to_ascii_lowercase()) }) else { return };
                let Some(keys) = self.macros.get(&name).cloned() else { return };
                self.last_macro = Some(name);
                let playing = std::mem::replace(&mut self.playing_macro, true);
                for _ in 0..times {
                    self.play(&keys, document, context, effects);
                }
                self.playing_macro = playing;
            }
            Action::SetMark(name) => {
                if name.is_ascii_alphabetic() {
                    self.marks.insert(name, (line, column_of(&buffer, head)));
                }
            }
            Action::VisualOp(op) => {
                let (start, end) = self.visual_range(&buffer);
                let linewise = self.mode == VimMode::VisualLine;
                // Linewise ranges name their last line by an offset inside it.
                let end = if linewise && end > start { end - 1 } else { end };
                self.apply_operator(op, register, start, end, linewise, document, effects);
                if op == Op::Yank {
                    document.set_cursor(start);
                }
            }
            Action::ReplaceMode => self.mode = VimMode::Replace,
            Action::Repeat => {
                let keys = self.last_change.clone();
                if keys.is_empty() {
                    return;
                }
                self.replaying = true;
                document.history.begin_group();
                for _ in 0..times {
                    for key in &keys {
                        let more = self.handle(*key, document, context);
                        effects.extend(more);
                    }
                }
                document.history.end_group();
                self.replaying = false;
            }
            Action::Prompt(kind) => effects.push(Effect::Prompt(kind)),
            Action::SearchWord(forward) => {
                let Some(word) = buffer.word_range_at(head).or_else(|| buffer.word_range_at(buffer.next_boundary(head))) else { return };
                let pattern = format!("\\b{}\\b", regex::escape(&buffer.slice(word.clone())));
                self.set_search(pattern.clone(), forward);
                self.remember_jump(&buffer, head);
                if let Some(at) = Self::search_from(&buffer, &pattern, word.start, forward) {
                    document.set_cursor(at);
                }
            }
            Action::Fold(fold) => effects.push(Effect::Fold(fold)),
        }
    }

    /// Feeds a macro's keys; a command line it opened takes the keys up to enter.
    fn play(&mut self, keys: &[Key], document: &mut Document, context: &VimContext, effects: &mut Vec<Effect>) {
        let mut keys = keys.iter().copied();
        while let Some(key) = keys.next() {
            for effect in self.handle(key, document, context) {
                let Effect::Prompt(kind) = effect else {
                    effects.push(effect);
                    continue;
                };
                let line: String = keys.by_ref().take_while(|key| *key != Key::Enter).filter_map(|key| if let Key::Char(ch) = key { Some(ch) } else { None }).collect();
                let more = if kind == ':' { self.ex(&line, document) } else { self.search(&line, kind == '/', document) };
                effects.extend(more);
            }
        }
    }

    /// An operator on block visual mode's rectangle.
    fn block_operator(&mut self, op: Op, register: Option<char>, document: &mut Document, effects: &mut Vec<Effect>) {
        let buffer = document.buffer.clone();
        let (first, last, start, _) = self.block_bounds(&buffer);
        let ranges = self.block_ranges(&buffer);
        let corner = char_offset(&buffer, first, start).min(last_char(&buffer, first).max(buffer.line_start(first)));
        let text = ranges.iter().map(|(_, range)| buffer.slice(range.clone())).collect::<Vec<_>>().join("\n");
        self.mode = VimMode::Normal;
        match op {
            Op::Yank => {
                self.write_register(register, text, false, true, effects);
                document.set_cursor(corner);
            }
            Op::Delete => {
                self.write_register(register, text, false, false, effects);
                let edits = ranges.into_iter().map(|(_, range)| (range, String::new())).collect();
                document.apply_edits(edits, vec![Target::Exact { anchor: corner, head: corner }], EditKind::Other);
            }
            Op::Change => {
                self.write_register(register, text, false, false, effects);
                let mut targets: Vec<Target> = ranges.iter().map(|(_, range)| Target::Mapped { anchor: range.start, head: range.start }).collect();
                if targets.is_empty() {
                    targets.push(Target::Exact { anchor: corner, head: corner });
                }
                let edits = ranges.into_iter().map(|(_, range)| (range, String::new())).collect();
                document.apply_edits(edits, targets, EditKind::Other);
                let carets: Vec<_> = document.selections.iter().map(Selection::range).collect();
                Self::set_block_carets(document, carets, false);
                self.mode = VimMode::Insert;
            }
            Op::ToggleCase | Op::Lowercase | Op::Uppercase => {
                let edits = ranges
                    .into_iter()
                    .map(|(_, range)| {
                        let changed = change_case(op, &buffer.slice(range.clone()));
                        (range, changed)
                    })
                    .collect();
                document.apply_edits(edits, vec![Target::Exact { anchor: corner, head: corner }], EditKind::Other);
            }
            Op::Indent | Op::Outdent => {
                self.apply_operator(op, register, buffer.line_start(first), buffer.line_start(last), true, document, effects);
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn paste(&mut self, register: Option<char>, times: usize, after: bool, head: usize, document: &mut Document, context: &VimContext, effects: &mut Vec<Effect>) {
        let Some(contents) = self.read_register(register, context) else { return };
        let buffer = document.buffer.clone();
        if self.mode.is_visual() {
            let (start, end) = self.visual_range(&buffer);
            let removed = buffer.slice(start..end);
            let text = if contents.linewise && self.mode != VimMode::VisualLine { format!("\n{}", contents.text) } else { contents.text.clone() };
            document.apply_edits(vec![(start..end, text)], vec![Target::Exact { anchor: start, head: start }], EditKind::Other);
            self.write_register(None, removed, self.mode == VimMode::VisualLine, false, effects);
            self.mode = VimMode::Normal;
            return;
        }
        let text = contents.text.repeat(times);
        let line = buffer.line_of(head);
        if contents.linewise {
            let body = if text.ends_with('\n') { text.clone() } else { format!("{text}\n") };
            let (at, inserted) = if after {
                if line + 1 < buffer.line_count() {
                    (buffer.line_start(line + 1), body)
                } else {
                    (buffer.len(), format!("\n{}", body.trim_end_matches('\n')))
                }
            } else {
                (buffer.line_start(line), body)
            };
            let new_line_start = if inserted.starts_with('\n') && !after { at } else if inserted.starts_with('\n') { at + 1 } else { at };
            document.apply_edits(vec![(at..at, inserted)], vec![Target::Exact { anchor: new_line_start, head: new_line_start }], EditKind::Other);
            let line = document.buffer.line_of(new_line_start);
            document.set_cursor(first_non_blank(&document.buffer, line));
        } else {
            let at = if after && buffer.char_at(head).is_some_and(|ch| ch != '\n') { buffer.next_boundary(head) } else { head };
            let caret = at + text.len() - text.chars().next_back().map(char::len_utf8).unwrap_or(0);
            document.apply_edits(vec![(at..at, text)], vec![Target::Exact { anchor: caret, head: caret }], EditKind::Other);
        }
    }

    /// Runs a `/` or `?` search from the command line.
    pub fn search(&mut self, pattern: &str, forward: bool, document: &mut Document) -> Vec<Effect> {
        let pattern = if pattern.is_empty() { self.last_search.as_ref().map(|(pattern, _)| pattern.clone()).unwrap_or_default() } else { pattern.to_string() };
        if compile_pattern(&pattern).is_none() {
            return vec![Effect::Message(format!("Invalid pattern: {pattern}"))];
        }
        if !self.playing_macro
            && let Some((_, keys)) = &mut self.macro_recording
        {
            keys.extend(pattern.chars().map(Key::Char));
            keys.push(Key::Enter);
        }
        self.set_search(pattern.clone(), forward);
        let head = if self.mode.is_visual() { self.visual_head } else { Self::head(document) };
        self.remember_jump(&document.buffer, head);
        match Self::search_from(&document.buffer, &pattern, head, forward) {
            Some(at) => {
                if self.mode.is_visual() {
                    self.visual_head = at;
                    self.show_visual(document);
                } else {
                    document.set_cursor(at);
                }
                Vec::new()
            }
            None => vec![Effect::Message(format!("Pattern not found: {pattern}"))],
        }
    }

    /// Runs an ex command (without the `:`).
    pub fn ex(&mut self, command: &str, document: &mut Document) -> Vec<Effect> {
        let command = command.trim();
        if !self.playing_macro
            && let Some((_, keys)) = &mut self.macro_recording
        {
            keys.extend(command.chars().map(Key::Char));
            keys.push(Key::Enter);
        }
        if self.mode.is_visual() {
            self.mode = VimMode::Normal;
            let head = self.visual_head;
            document.set_cursor(head);
        }
        let line_count = document.buffer.line_count();
        let current = document.buffer.line_of(Self::head(document));
        // A range: `%`, `'<,'>`, `N,M`, `.`, `$`, or a single line.
        let (range, rest) = parse_range(command, current, line_count, self.last_visual_lines);
        let rest = rest.trim();
        if rest.is_empty() {
            if let Some((_, last)) = range {
                let line = last.min(line_count - 1);
                self.remember_jump(&document.buffer, Self::head(document));
                document.set_cursor(first_non_blank(&document.buffer, line));
            }
            return Vec::new();
        }
        let (range_first, range_last) = range.unwrap_or((current, current));
        if let Some(substitute) = rest.strip_prefix("substitute").or_else(|| rest.strip_prefix('s')).filter(|after| after.starts_with(|ch: char| !ch.is_alphanumeric() && ch != ' '))
        {
            return self.substitute(substitute, range_first, range_last, document);
        }
        let (name, args) = rest.split_once(char::is_whitespace).map(|(name, args)| (name, args.trim())).unwrap_or((rest, ""));
        let effects = match name {
            "w" | "write" | "wa" | "wall" | "up" | "update" => vec![Effect::Save],
            "q" | "quit" | "close" | "qa" | "qall" => vec![Effect::Close { force: false }],
            "q!" | "quit!" | "qa!" => vec![Effect::Close { force: true }],
            "wq" | "x" | "xit" | "wqa" | "xa" => vec![Effect::SaveAndClose],
            "e" | "edit" | "explore" | "Ex" => vec![Effect::Command("file.quickOpen")],
            "command" | "cmd" => vec![Effect::Command("workbench.commandPalette")],
            "sidebar" | "sb" => vec![Effect::Command("workbench.toggleSidebar")],
            "terminal" | "term" => vec![Effect::Command("workbench.toggleTerminal")],
            "goto" => match args.parse::<usize>() {
                Ok(line) => {
                    let line = line.saturating_sub(1).min(line_count - 1);
                    self.remember_jump(&document.buffer, Self::head(document));
                    document.set_cursor(first_non_blank(&document.buffer, line));
                    Vec::new()
                }
                Err(_) => vec![Effect::Message(format!("Invalid line: {args}"))],
            },
            "u" | "undo" | "red" | "redo" => {
                let undo = matches!(name, "u" | "undo");
                if !(if undo { document.undo() } else { document.redo() }) {
                    return vec![Effect::Message(if undo { "Already at oldest change" } else { "Already at newest change" }.into())];
                }
                let start = document.newest_selection().start();
                document.set_cursor(start);
                Vec::new()
            }
            "noh" | "nohlsearch" => {
                self.highlight_search = false;
                Vec::new()
            }
            "set" => match args {
                "rnu" | "relativenumber" => {
                    self.relative_numbers = Some(true);
                    Vec::new()
                }
                "nornu" | "norelativenumber" => {
                    self.relative_numbers = Some(false);
                    Vec::new()
                }
                other => vec![Effect::Message(format!("Unknown option: {other}"))],
            },
            "d" | "delete" => {
                self.apply_operator(Op::Delete, None, document.buffer.line_start(range_first), document.buffer.line_start(range_last.min(line_count - 1)), true, document, &mut Vec::new());
                Vec::new()
            }
            "y" | "yank" => {
                let mut effects = Vec::new();
                let start = document.buffer.line_start(range_first);
                self.apply_operator(Op::Yank, None, start, document.buffer.line_start(range_last.min(line_count - 1)), true, document, &mut effects);
                effects
            }
            other => vec![Effect::Message(format!("Not an editor command: {other}"))],
        };
        self.clamp(document);
        effects
    }

    fn substitute(&mut self, rest: &str, first: usize, last: usize, document: &mut Document) -> Vec<Effect> {
        let Some((pattern, replacement, flags)) = split_substitute(rest) else { return vec![Effect::Message("Invalid substitute".into())] };
        let pattern = if pattern.is_empty() { self.last_search.as_ref().map(|(pattern, _)| pattern.clone()).unwrap_or_default() } else { pattern };
        let pattern = if flags.contains('i') { format!("\\c{pattern}") } else { pattern };
        let Some(regex) = compile_pattern(&pattern) else { return vec![Effect::Message(format!("Invalid pattern: {pattern}"))] };
        self.set_search(pattern.trim_start_matches("\\c").to_string(), true);
        let replacement = convert_replacement(&replacement);
        let global = flags.contains('g');
        let buffer = &document.buffer;
        let mut edits = Vec::new();
        let mut last_changed = None;
        for line in first..=last.min(buffer.line_count() - 1) {
            let text = buffer.line(line);
            let replaced = if global { regex.replace_all(&text, replacement.as_str()) } else { regex.replace(&text, replacement.as_str()) };
            if replaced != text {
                let start = buffer.line_start(line);
                edits.push((start..start + text.len(), replaced.into_owned()));
                last_changed = Some(line);
            }
        }
        let Some(line) = last_changed else { return vec![Effect::Message(format!("Pattern not found: {pattern}"))] };
        document.history.begin_group();
        document.apply_edits(edits, vec![Target::Exact { anchor: 0, head: 0 }], EditKind::Other);
        document.history.end_group();
        document.set_cursor(first_non_blank(&document.buffer, line));
        Vec::new()
    }
}

fn toggle_case(ch: char) -> char {
    if ch.is_uppercase() { ch.to_lowercase().next().unwrap_or(ch) } else { ch.to_uppercase().next().unwrap_or(ch) }
}

/// An ex range and what follows it. Lines are 0-based.
fn parse_range(command: &str, current: usize, line_count: usize, visual: Option<(usize, usize)>) -> (Option<(usize, usize)>, &str) {
    let last = line_count.saturating_sub(1);
    if let Some(rest) = command.strip_prefix('%') {
        return (Some((0, last)), rest);
    }
    if let Some(rest) = command.strip_prefix("'<,'>") {
        return (Some(visual.unwrap_or((current, current))), rest);
    }
    let address = |text: &str| -> Option<(usize, usize)> {
        let digits = text.chars().take_while(|ch| ch.is_ascii_digit()).count();
        if digits > 0 {
            return Some((text[..digits].parse::<usize>().ok()?.saturating_sub(1).min(last), digits));
        }
        match text.chars().next()? {
            '.' => Some((current, 1)),
            '$' => Some((last, 1)),
            _ => None,
        }
    };
    let Some((first, used)) = address(command) else { return (None, command) };
    let rest = &command[used..];
    if let Some(after_comma) = rest.strip_prefix(',')
        && let Some((second, used)) = address(after_comma)
    {
        return (Some((first.min(second), first.max(second))), &after_comma[used..]);
    }
    (Some((first, first)), rest)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::syntax::language_for_path;

    /// A document with the caret at `|` in `text`.
    fn setup(text: &str) -> (Vim, Document) {
        let caret = text.find('|').expect("a caret");
        let text = text.replacen('|', "", 1);
        let mut document = Document::new(&text, language_for_path(Path::new("a.txt")));
        document.tab_size = 4;
        document.auto_close = false;
        document.set_cursor(caret);
        (Vim::default(), document)
    }

    fn keys(text: &str) -> Vec<Key> {
        let mut keys = Vec::new();
        for ch in text.chars() {
            keys.push(match ch {
                '⎋' => Key::Escape,
                '↩' => Key::Enter,
                '⌫' => Key::Backspace,
                other => Key::Char(other),
            });
        }
        keys
    }

    /// Feeds `input`; text typed in insert mode goes in as typing does.
    fn run(vim: &mut Vim, document: &mut Document, input: &str) -> Vec<Effect> {
        let context = VimContext { page_rows: 10, ..Default::default() };
        let mut effects = Vec::new();
        for key in keys(input) {
            if vim.mode == VimMode::Insert && key != Key::Escape {
                match key {
                    Key::Char(ch) => {
                        document.insert(&ch.to_string());
                        vim.record_typed(&ch.to_string());
                    }
                    Key::Enter => {
                        document.newline();
                        vim.record_key(Key::Enter);
                    }
                    Key::Backspace => {
                        document.backspace();
                        vim.record_key(Key::Backspace);
                    }
                    _ => {}
                }
                continue;
            }
            effects.extend(vim.handle(key, document, &context));
        }
        effects
    }

    /// The text with `|` at the caret.
    fn show(document: &Document) -> String {
        let mut text = document.buffer.text();
        text.insert(document.newest_selection().head, '|');
        text
    }

    fn check(start: &str, input: &str, expected: &str) {
        let (mut vim, mut document) = setup(start);
        run(&mut vim, &mut document, input);
        assert_eq!(show(&document), expected, "{start:?} + {input:?}");
    }

    #[test]
    fn hjkl_and_counts() {
        check("ab|cd\nefgh", "l", "abc|d\nefgh");
        check("ab|cd\nefgh", "ll", "abc|d\nefgh");
        check("ab|cd\nefgh", "h", "a|bcd\nefgh");
        check("ab|cd\nefgh", "j", "abcd\nef|gh");
        check("abcd\nef|gh", "k", "ab|cd\nefgh");
        check("a|bcdef", "3l", "abcd|ef");
        check("abc|def\nx\nabcdef", "jj", "abcdef\nx\nabc|def");
    }

    #[test]
    fn word_motions() {
        check("|foo bar.baz qux", "w", "foo |bar.baz qux");
        check("|foo bar.baz qux", "ww", "foo bar|.baz qux");
        check("|foo bar.baz qux", "W", "foo |bar.baz qux");
        check("|foo bar.baz qux", "WW", "foo bar.baz |qux");
        check("|foo bar", "e", "fo|o bar");
        check("fo|o bar", "e", "foo ba|r");
        check("foo bar|", "b", "foo |bar");
        check("foo bar.ba|z", "B", "foo |bar.baz");
        check("|one\n\ntwo", "w", "one\n|\ntwo");
        check("one\n\n|two", "b", "one\n|\ntwo");
        check("|a b c d", "3w", "a b c |d");
    }

    #[test]
    fn line_motions() {
        check("  ab|cd", "0", "|  abcd");
        check("  ab|cd", "^", "  |abcd");
        check("|abcd\nxy", "$", "abc|d\nxy");
        check("a\nb\n|c", "gg", "|a\nb\nc");
        check("|a\nb\n  c", "G", "a\nb\n  |c");
        check("|a\nb\nc", "2G", "a\n|b\nc");
        check("|a\n  b", "↩", "a\n  |b");
        check("a\n  |b", "-", "|a\n  b");
    }

    #[test]
    fn find_and_repeat() {
        check("|a,b,c,d", "f,", "a|,b,c,d");
        check("|a,b,c,d", "f,;", "a,b|,c,d");
        check("|a,b,c,d", "f,;,", "a|,b,c,d");
        check("|a,b,c,d", "t,", "|a,b,c,d");
        check("|ab,c", "t,", "a|b,c");
        check("a,b,c|", "F,", "a,b|,c");
        check("a,b,cd|", "T,", "a,b,|cd");
        check("|a,b,c,d", "2f,", "a,b|,c,d");
    }

    #[test]
    fn brackets_and_paragraphs() {
        check("|f(a(b)c)", "%", "f(a(b)c|)");
        check("f(a(b)c|)", "%", "f|(a(b)c)");
        check("|a\nb\n\nc\nd", "}", "a\nb\n|\nc\nd");
        check("a\nb\n\nc\n|d", "{", "a\nb\n|\nc\nd");
    }

    #[test]
    fn delete_with_motions() {
        check("|foo bar baz", "dw", "|bar baz");
        check("|foo bar baz", "2dw", "|baz");
        check("|foo bar baz", "d2w", "|baz");
        check("foo |bar", "dw", "foo| ");
        check("|foo bar", "de", "| bar");
        check("foo b|ar", "d$", "foo |b");
        check("foo b|ar", "D", "foo |b");
        check("foo b|ar", "d0", "|ar");
        check("|a,b,c", "dt,", "|,b,c");
        check("|a,b,c", "df,", "|b,c");
        check("ab|cd", "x", "ab|d");
        check("ab|cd", "3x", "a|b");
        check("ab|cd", "X", "a|cd");
    }

    #[test]
    fn linewise_operators() {
        check("one\n|two\nthree", "dd", "one\n|three");
        check("one\ntwo\n|three", "dd", "one\n|two");
        check("|one\ntwo\nthree", "2dd", "|three");
        check("|one\ntwo\nthree", "dj", "|three");
        check("one\ntwo\n|three", "dk", "|one");
        check("  |one\ntwo", "cc", "  |\ntwo");
        check("|a\nb\nc", "dG", "|");
        check("a\n|b\nc", "dgg", "|c");
        check("|a\nb", ">>", "    |a\nb");
        check("    |a\nb", "<<", "|a\nb");
    }

    #[test]
    fn change_enters_insert_mode() {
        check("|foo bar", "cwxy⎋", "x|y bar");
        check("|foo bar", "ciwxy⎋", "x|y bar");
        check("foo b|ar", "C!⎋", "foo b|!");
        check("ab|cd", "sX⎋", "ab|Xd");
        check("  a|b\nc", "SX⎋", "  |X\nc");
    }

    #[test]
    fn text_objects() {
        check("foo b|ar baz", "diw", "foo | baz");
        check("foo b|ar baz", "daw", "foo |baz");
        check("say \"he|llo\" now", "di\"", "say \"|\" now");
        check("say \"he|llo\" now", "da\"", "say | now");
        check("f(a, |b)", "di(", "f(|)");
        check("f(a, |b)", "da(", "|f");
        check("f(a, |b)", "dib", "f(|)");
        check("x[1, |2]", "ci[9⎋", "x[|9]");
        check("{ a { |b } }", "di{", "{ a {|} }");
        check("{ a { |b } }", "da{", "{ a | }");
        check("a\n|b\nc\n\nd", "dip", "|\nd");
        check("a\n|b\n\nd", "dap", "|d");
        check("'it|s'", "ci'x⎋", "'|x'");
    }

    #[test]
    fn yank_and_put() {
        check("|foo bar", "yiwP", "fo|ofoo bar");
        check("|foo bar", "yiw$p", "foo barfo|o");
        check("|one\ntwo", "yyp", "one\n|one\ntwo");
        check("|one\ntwo", "yyjp", "one\ntwo\n|one");
        check("one\n|two", "yyP", "one\n|two\ntwo");
        check("|one\ntwo", "ddp", "two\n|one");
        check("|ab", "xp", "b|a");
        check("|a b", "\"ayiww\"ap", "a b|a");
        check("|one", "yy3p", "one\n|one\none\none");
    }

    #[test]
    fn registers_keep_their_text() {
        let (mut vim, mut document) = setup("|one two");
        run(&mut vim, &mut document, "\"qyiw");
        assert_eq!(vim.register('q').map(|register| register.text.as_str()), Some("one"));
        run(&mut vim, &mut document, "\"Qyiw");
        assert_eq!(vim.register('q').map(|register| register.text.as_str()), Some("oneone"));
        run(&mut vim, &mut document, "\"_dw");
        assert_eq!(vim.register('"').map(|register| register.text.as_str()), Some("one"));
        let effects = run(&mut vim, &mut document, "\"+yiw");
        assert_eq!(effects, vec![Effect::Clipboard("two".into())]);
    }

    #[test]
    fn undo_redo_and_dot() {
        check("|foo bar baz", "dwu", "|foo bar baz");
        let (mut vim, mut document) = setup("|foo bar baz");
        run(&mut vim, &mut document, "dwu");
        let context = VimContext::default();
        vim.handle(Key::Ctrl('r'), &mut document, &context);
        assert_eq!(show(&document), "|bar baz");
        check("|a b c d", "dw..", "|d");
        check("|a\nb\nc\nd", "dd.", "|c\nd");
        check("|foo foo", "cwbar⎋w.", "bar ba|r");
        check("|x\ny", "Aend⎋j.", "xend\nyen|d");
        check("|ab", "ix⎋u", "|ab");
        // An insert after `cw` undoes with the change.
        check("|foo bar", "cwnew⎋u", "|foo bar");
    }

    #[test]
    fn inserting() {
        check("ab|c", "iX⎋", "ab|Xc");
        check("ab|c", "aX⎋", "abc|X");
        check("  ab|c", "IX⎋", "  |Xabc");
        check("a|bc", "AX⎋", "abc|X");
        check("  a|b\nc", "ox⎋", "  ab\n  |x\nc");
        check("  a|b\nc", "Ox⎋", "  |x\n  ab\nc");
        check("|abc", "RXY⎋", "X|Yc");
        check("|abc", "rx", "|xbc");
        check("|abc", "2rx", "x|xc");
        check("|aBc", "~~", "Ab|c");
    }

    #[test]
    fn join_lines() {
        check("|a\n  b\nc", "J", "a| b\nc");
        check("|a\nb\nc", "3J", "a b| c");
    }

    #[test]
    fn visual_mode() {
        check("|abcdef", "vlld", "|def");
        check("|abcdef", "vllyP", "ab|cabcdef");
        check("a|bcdef", "vlx", "a|def");
        check("|one\ntwo\nthree", "Vjd", "|three");
        check("|one\ntwo", "Vy", "|one\ntwo");
        check("|abc", "v~", "|Abc");
        check("|ab cd", "veohd", "| cd");
        check("foo b|ar baz", "viwd", "foo | baz");
        check("|one\ntwo", "Vj>", "    |one\n    two");
        check("|ab", "vl⎋", "a|b");
        let (mut vim, mut document) = setup("|abc");
        run(&mut vim, &mut document, "vl");
        assert_eq!(vim.mode, VimMode::Visual);
        assert_eq!(document.newest_selection().range(), 0..2);
        assert_eq!(vim.visual_head(), Some(1));
        run(&mut vim, &mut document, "V");
        assert_eq!(vim.mode, VimMode::VisualLine);
    }

    #[test]
    fn search_forward_back_and_repeat() {
        let (mut vim, mut document) = setup("|foo bar foo bar foo");
        vim.search("bar", true, &mut document);
        assert_eq!(show(&document), "foo |bar foo bar foo");
        run(&mut vim, &mut document, "n");
        assert_eq!(show(&document), "foo bar foo |bar foo");
        run(&mut vim, &mut document, "N");
        assert_eq!(show(&document), "foo |bar foo bar foo");
        run(&mut vim, &mut document, "n");
        run(&mut vim, &mut document, "n");
        assert_eq!(show(&document), "foo |bar foo bar foo");
        vim.search("foo", false, &mut document);
        assert_eq!(show(&document), "|foo bar foo bar foo");
        check("|foo x foo", "*", "foo x |foo");
        let (mut vim, mut document) = setup("|foo bar foo");
        vim.search("bar", true, &mut document);
        run(&mut vim, &mut document, "0dn");
        assert_eq!(show(&document), "|bar foo");
        let (mut vim, mut document) = setup("|a");
        assert_eq!(vim.search("zzz", true, &mut document), vec![Effect::Message("Pattern not found: zzz".into())]);
    }

    #[test]
    fn ex_commands() {
        let (mut vim, mut document) = setup("|a\nb\nc\nd");
        assert_eq!(vim.ex("w", &mut document), vec![Effect::Save]);
        assert_eq!(vim.ex("q", &mut document), vec![Effect::Close { force: false }]);
        assert_eq!(vim.ex("q!", &mut document), vec![Effect::Close { force: true }]);
        assert_eq!(vim.ex("wq", &mut document), vec![Effect::SaveAndClose]);
        assert_eq!(vim.ex("x", &mut document), vec![Effect::SaveAndClose]);
        vim.ex("3", &mut document);
        assert_eq!(show(&document), "a\nb\n|c\nd");
        vim.ex("$", &mut document);
        assert_eq!(show(&document), "a\nb\nc\n|d");
        vim.ex("set rnu", &mut document);
        assert_eq!(vim.relative_numbers, Some(true));
        assert!(matches!(vim.ex("bogus", &mut document)[..], [Effect::Message(_)]));
        let (mut vim, mut document) = setup("|q\nq\nq");
        vim.ex("2,3d", &mut document);
        assert_eq!(document.buffer.text(), "q");
    }

    #[test]
    fn substitute() {
        let (mut vim, mut document) = setup("|a a\na a");
        vim.ex("s/a/b/", &mut document);
        assert_eq!(document.buffer.text(), "b a\na a");
        vim.ex("s/a/b/g", &mut document);
        assert_eq!(document.buffer.text(), "b b\na a");
        vim.ex("%s/a/c/g", &mut document);
        assert_eq!(document.buffer.text(), "b b\nc c");
        vim.ex("%s/\\(b\\) b/[\\1]/", &mut document);
        assert_eq!(document.buffer.text(), "[b]\nc c");
        vim.ex("%s/C/&&/gi", &mut document);
        assert_eq!(document.buffer.text(), "[b]\ncc cc");
        vim.ex("%s#cc#x/y#", &mut document);
        assert_eq!(document.buffer.text(), "[b]\nx/y cc");
        // One undo step for the whole substitution.
        document.undo();
        assert_eq!(document.buffer.text(), "[b]\ncc cc");
        let (mut vim, mut document) = setup("|a\nb\nc");
        run(&mut vim, &mut document, "Vj");
        vim.ex("'<,'>s/^/-/", &mut document);
        assert_eq!(document.buffer.text(), "-a\n-b\nc");
    }

    #[test]
    fn folds_are_stepped_over() {
        let (mut vim, mut document) = setup("|a\nb\nc\nd");
        let context = VimContext { hidden: vec![(1, 2)], ..Default::default() };
        vim.handle(Key::Char('j'), &mut document, &context);
        assert_eq!(show(&document), "a\nb\nc\n|d");
        vim.handle(Key::Char('k'), &mut document, &context);
        assert_eq!(show(&document), "|a\nb\nc\nd");
    }

    fn ctrl(vim: &mut Vim, document: &mut Document, ch: char) {
        vim.handle(Key::Ctrl(ch), document, &VimContext { page_rows: 10, ..Default::default() });
    }

    #[test]
    fn macros_record_and_replay() {
        check("|a1\na2\na3\na4", "qaA!⎋jqj@a", "a1!\na2\na3!\na|4");
        check("|a1\na2\na3\na4", "qaA!⎋jq2@a", "a1!\na2!\na3!\na|4");
        check("|x\nx\nx\nx", "qbI-⎋jq@b@@", "-x\n-x\n-x\n|x");
        let (mut vim, mut document) = setup("|a b c d");
        run(&mut vim, &mut document, "qcdwq");
        assert_eq!(vim.recording_macro(), None);
        run(&mut vim, &mut document, "@c");
        assert_eq!(show(&document), "|c d");
        // A command line typed while recording replays too.
        let (mut vim, mut document) = setup("|a\na\na");
        run(&mut vim, &mut document, "qd:");
        assert_eq!(vim.recording_macro(), Some('d'));
        vim.ex("s/a/b/", &mut document);
        run(&mut vim, &mut document, "jq@d");
        assert_eq!(document.buffer.text(), "b\nb\na");
    }

    #[test]
    fn marks_jump_and_take_operators() {
        check("ab|c\nd\n  ef", "majj'a", "|abc\nd\n  ef");
        check("ab|c\nd\n  ef", "majj`a", "ab|c\nd\n  ef");
        check("|a\nb\nc\nd", "mbjjd'b", "|d");
        check("|a\nb\nc", "G''", "|a\nb\nc");
        check("x|yz w", "mmwy`mP", "xyz| yz w");
    }

    #[test]
    fn case_operators() {
        check("|Foo Bar", "guw", "|foo Bar");
        check("|Foo Bar", "gUiw", "|FOO Bar");
        check("|Foo Bar", "g~$", "|fOO bAR");
        check("ab|c\ndef", "gUU", "AB|C\ndef");
        check("ab|c\ndef", "gUgU", "AB|C\ndef");
        check("ab|C\ndef", "guu", "ab|c\ndef");
        check("a|bc", "g~~", "A|BC");
        check("|abc\ndef", "gUj", "|ABC\nDEF");
        check("|abc", "vlU", "|ABc");
        check("|ABC", "vlu", "|abC");
    }

    #[test]
    fn block_visual() {
        let (mut vim, mut document) = setup("|abcd\nefgh\nijkl");
        ctrl(&mut vim, &mut document, 'v');
        assert_eq!(vim.mode, VimMode::VisualBlock);
        run(&mut vim, &mut document, "jl");
        let ranges: Vec<_> = document.selections.iter().map(Selection::range).collect();
        assert_eq!(ranges, vec![0..2, 5..7]);
        assert_eq!(vim.visual_head(), Some(6));
        run(&mut vim, &mut document, "d");
        assert_eq!(show(&document), "|cd\ngh\nijkl");
        assert_eq!(vim.mode, VimMode::Normal);

        let (mut vim, mut document) = setup("a|bcd\nefgh\nijkl");
        ctrl(&mut vim, &mut document, 'v');
        run(&mut vim, &mut document, "jjly");
        assert_eq!(vim.register('"').map(|register| register.text.as_str()), Some("bc\nfg\njk"));
        assert_eq!(show(&document), "a|bcd\nefgh\nijkl");

        let (mut vim, mut document) = setup("|abc\ndef");
        ctrl(&mut vim, &mut document, 'v');
        run(&mut vim, &mut document, "jI# ⎋");
        assert_eq!(document.buffer.text(), "# abc\n# def");
        assert_eq!(vim.mode, VimMode::Normal);

        let (mut vim, mut document) = setup("|abc\nd\nefg");
        ctrl(&mut vim, &mut document, 'v');
        run(&mut vim, &mut document, "jjlA;⎋");
        assert_eq!(document.buffer.text(), "ab;c\nd ;\nef;g");

        let (mut vim, mut document) = setup("|abc\nd\nefg");
        ctrl(&mut vim, &mut document, 'v');
        run(&mut vim, &mut document, "jj$A;⎋");
        assert_eq!(document.buffer.text(), "abc;\nd;\nefg;");

        let (mut vim, mut document) = setup("|abc\ndef");
        ctrl(&mut vim, &mut document, 'v');
        run(&mut vim, &mut document, "jlcX⎋");
        assert_eq!(document.buffer.text(), "Xc\nXf");

        let (mut vim, mut document) = setup("|abc\ndef");
        ctrl(&mut vim, &mut document, 'v');
        run(&mut vim, &mut document, "jlU");
        assert_eq!(document.buffer.text(), "ABc\nDEf");

        let (mut vim, mut document) = setup("|abc\ndef");
        ctrl(&mut vim, &mut document, 'v');
        run(&mut vim, &mut document, "jlrx");
        assert_eq!(document.buffer.text(), "xxc\nxxf");

        let (mut vim, mut document) = setup("|abc\ndef");
        ctrl(&mut vim, &mut document, 'v');
        run(&mut vim, &mut document, "jlo");
        assert_eq!(vim.visual_head(), Some(0));
        run(&mut vim, &mut document, "O");
        assert_eq!(vim.visual_head(), Some(1));
        run(&mut vim, &mut document, ">");
        assert_eq!(document.buffer.text(), "    abc\n    def");
    }

    #[test]
    fn workbench_ex_commands() {
        let (mut vim, mut document) = setup("|a\nb\nc");
        assert_eq!(vim.ex("e", &mut document), vec![Effect::Command("file.quickOpen")]);
        assert_eq!(vim.ex("Ex", &mut document), vec![Effect::Command("file.quickOpen")]);
        assert_eq!(vim.ex("e src/main.rs", &mut document), vec![Effect::Command("file.quickOpen")]);
        assert_eq!(vim.ex("cmd", &mut document), vec![Effect::Command("workbench.commandPalette")]);
        assert_eq!(vim.ex("sb", &mut document), vec![Effect::Command("workbench.toggleSidebar")]);
        assert_eq!(vim.ex("terminal", &mut document), vec![Effect::Command("workbench.toggleTerminal")]);
        vim.ex("goto 3", &mut document);
        assert_eq!(show(&document), "a\nb\n|c");
        vim.ex("set nornu", &mut document);
        assert_eq!(vim.relative_numbers, Some(false));
        run(&mut vim, &mut document, "dd");
        vim.ex("undo", &mut document);
        assert_eq!(document.buffer.text(), "a\nb\nc");
        vim.ex("redo", &mut document);
        assert_eq!(document.buffer.text(), "a\nb");
    }

    #[test]
    fn search_highlight_until_noh() {
        let (mut vim, mut document) = setup("|foo bar foo");
        assert!(vim.search_highlight().is_none());
        vim.search("foo", true, &mut document);
        assert_eq!(vim.search_highlight().map(|regex| regex.find_iter("foo bar foo").count()), Some(2));
        vim.ex("noh", &mut document);
        assert!(vim.search_highlight().is_none());
        run(&mut vim, &mut document, "n");
        assert!(vim.search_highlight().is_some());
        assert_eq!(show(&document), "|foo bar foo");
        vim.ex("nohlsearch", &mut document);
        run(&mut vim, &mut document, "w*");
        assert!(vim.search_highlight().is_some());
    }

    #[test]
    fn pending_keys_and_escape() {
        let (mut vim, mut document) = setup("|abc");
        let context = VimContext::default();
        vim.handle(Key::Char('2'), &mut document, &context);
        vim.handle(Key::Char('d'), &mut document, &context);
        assert_eq!(vim.pending_keys(), "2d");
        vim.handle(Key::Escape, &mut document, &context);
        assert_eq!(vim.pending_keys(), "");
        assert_eq!(vim.handle(Key::Char(':'), &mut document, &context), vec![Effect::Prompt(':')]);
        assert_eq!(vim.handle(Key::Char('z'), &mut document, &context), vec![]);
        assert_eq!(vim.handle(Key::Char('a'), &mut document, &context), vec![Effect::Fold(FoldCommand::Toggle)]);
    }
}
