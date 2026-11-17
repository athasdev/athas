//! Delimited text (`csv/lib/csv-utils.ts`): delimiter detection, a quote-aware parser, column
//! widths, and copying the table back out as CSV or JSON.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delimiter {
    Comma,
    Tab,
    Semicolon,
    Pipe,
}

impl Delimiter {
    pub const ALL: [Delimiter; 4] = [Delimiter::Comma, Delimiter::Tab, Delimiter::Semicolon, Delimiter::Pipe];

    pub fn char(self) -> char {
        match self {
            Delimiter::Comma => ',',
            Delimiter::Tab => '\t',
            Delimiter::Semicolon => ';',
            Delimiter::Pipe => '|',
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Delimiter::Comma => "Comma",
            Delimiter::Tab => "Tab",
            Delimiter::Semicolon => "Semicolon",
            Delimiter::Pipe => "Pipe",
        }
    }
}

/// Picks the delimiter that splits the first lines into the most, and most consistent, columns.
pub fn detect_delimiter(text: &str) -> Delimiter {
    let lines: Vec<&str> = text.lines().take(50).collect();
    let score = |delimiter: Delimiter| {
        let counts: Vec<f64> = lines.iter().map(|line| line.matches(delimiter.char()).count() as f64).collect();
        let n = counts.len().max(1) as f64;
        let mean = counts.iter().sum::<f64>() / n;
        let variance = counts.iter().map(|count| (count - mean).powi(2)).sum::<f64>() / n;
        (mean, variance)
    };
    let mut best = (Delimiter::Comma, score(Delimiter::Comma));
    for delimiter in Delimiter::ALL.into_iter().skip(1) {
        let (mean, variance) = score(delimiter);
        let (best_mean, best_variance) = best.1;
        if mean > best_mean || (mean == best_mean && variance < best_variance) {
            best = (delimiter, (mean, variance));
        }
    }
    best.0
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Table {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// Parses delimited text: quoted fields may hold delimiters, newlines and `""` escapes, `\r` is
/// dropped outside quotes. With `has_header` the first row names the columns; otherwise they are
/// "Column 1", "Column 2"…. Every row is padded to the widest row.
pub fn parse(text: &str, delimiter: Delimiter, has_header: bool) -> Table {
    let delimiter = delimiter.char();
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(char) = chars.next() {
        if in_quotes {
            if char == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(char);
            }
        } else if char == '"' {
            in_quotes = true;
        } else if char == delimiter {
            row.push(std::mem::take(&mut field));
        } else if char == '\n' {
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
        } else if char != '\r' {
            field.push(char);
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }

    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    let (headers, mut rows) = if has_header && !rows.is_empty() {
        let mut rows = rows;
        let headers = rows.remove(0);
        (headers, rows)
    } else {
        ((1..=width).map(|index| format!("Column {index}")).collect(), rows)
    };
    let width = width.max(headers.len());
    let mut headers = headers;
    headers.extend((headers.len() + 1..=width).map(|index| format!("Column {index}")));
    for row in &mut rows {
        row.resize(width, String::new());
    }
    Table { headers, rows }
}

/// Each column's width in characters: its widest value among the header and the first rows,
/// kept between `min` and `max`.
pub fn column_widths(table: &Table, sample_rows: usize, min: usize, max: usize) -> Vec<usize> {
    table
        .headers
        .iter()
        .enumerate()
        .map(|(column, header)| {
            let widest = table
                .rows
                .iter()
                .take(sample_rows)
                .filter_map(|row| row.get(column))
                .map(|value| value.chars().count())
                .chain([header.chars().count()])
                .max()
                .unwrap_or(0);
            widest.clamp(min, max)
        })
        .collect()
}

fn format_field(value: &str, delimiter: char) -> String {
    if value.contains([delimiter, '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Serializes the table back to delimited text, quoting fields that need it.
pub fn to_delimited(table: &Table, delimiter: Delimiter, with_header: bool) -> String {
    let delimiter = delimiter.char();
    let line = |row: &[String]| {
        row.iter().map(|value| format_field(value, delimiter)).collect::<Vec<_>>().join(&delimiter.to_string())
    };
    with_header
        .then(|| line(&table.headers))
        .into_iter()
        .chain(table.rows.iter().map(|row| line(row)))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The rows as a JSON array of objects keyed by column name.
pub fn to_json(table: &Table) -> String {
    let mut out = String::from("[");
    for (index, row) in table.rows.iter().enumerate() {
        out.push_str(if index == 0 { "\n  {" } else { ",\n  {" });
        for (column, header) in table.headers.iter().enumerate() {
            let key = if header.is_empty() { format!("Column {}", column + 1) } else { header.clone() };
            let value = row.get(column).map(String::as_str).unwrap_or_default();
            out.push_str(if column == 0 { "\n    " } else { ",\n    " });
            out.push_str(&json_string(&key));
            out.push_str(": ");
            out.push_str(&json_string(value));
        }
        out.push_str("\n  }");
    }
    out.push_str(if table.rows.is_empty() { "]" } else { "\n]" });
    out
}

fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for char in value.chars() {
        match char {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            char if (char as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", char as u32)),
            char => out.push(char),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_the_most_consistent_delimiter() {
        assert_eq!(detect_delimiter("a,b,c\n1,2,3\n"), Delimiter::Comma);
        assert_eq!(detect_delimiter("a\tb\n1\t2\n"), Delimiter::Tab);
        assert_eq!(detect_delimiter("a;b;c\n1;2,5;3\n"), Delimiter::Semicolon);
        assert_eq!(detect_delimiter("a|b\n1|2\n"), Delimiter::Pipe);
    }

    #[test]
    fn parses_quotes_escapes_and_newlines() {
        let table = parse("name,note\r\n\"Doe, J\",\"said \"\"hi\"\"\nthen left\"\nx,y", Delimiter::Comma, true);
        assert_eq!(table.headers, ["name", "note"]);
        assert_eq!(table.rows[0], ["Doe, J", "said \"hi\"\nthen left"]);
        assert_eq!(table.rows[1], ["x", "y"]);
    }

    #[test]
    fn pads_ragged_rows_and_names_missing_columns() {
        let table = parse("a,b\n1\n1,2,3\n", Delimiter::Comma, true);
        assert_eq!(table.headers, ["a", "b", "Column 3"]);
        assert_eq!(table.rows[0], ["1", "", ""]);
        let headerless = parse("1,2\n3,4", Delimiter::Comma, false);
        assert_eq!(headerless.headers, ["Column 1", "Column 2"]);
        assert_eq!(headerless.rows.len(), 2);
        assert_eq!(parse("", Delimiter::Comma, true), Table::default());
    }

    #[test]
    fn strips_a_byte_order_mark() {
        assert_eq!(parse("\u{feff}id\n1", Delimiter::Comma, true).headers, ["id"]);
    }

    #[test]
    fn widths_follow_content_within_bounds() {
        let table = parse("id,description\n1,a much longer value than the header\n", Delimiter::Comma, true);
        assert_eq!(column_widths(&table, 100, 4, 20), [4, 20]);
    }

    #[test]
    fn round_trips_to_csv_and_json() {
        let table = parse("a,b\n\"x,y\",\"q\"\"\"\n", Delimiter::Comma, true);
        assert_eq!(to_delimited(&table, Delimiter::Comma, true), "a,b\n\"x,y\",\"q\"\"\"");
        assert_eq!(to_delimited(&table, Delimiter::Tab, false), "x,y\t\"q\"\"\"");
        assert_eq!(to_json(&table), "[\n  {\n    \"a\": \"x,y\",\n    \"b\": \"q\\\"\"\n  }\n]");
        assert_eq!(to_json(&Table::default()), "[]");
    }
}
