//! Cell values as text: in the grid, in the row editor, and copied out as CSV or JSON
//! (`components/cell-renderer.tsx`, `lib/query-result-export.ts`).

use chrono::{DateTime, FixedOffset, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use serde_json::Value;

use crate::model::ResultSet;

/// The full text of a value, as the row editor and the clipboard take it. NULL is `None`.
pub fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Number(number) => Some(number.to_string()),
        other => Some(other.to_string()),
    }
}

/// One line of a value for a grid cell.
pub fn cell_text(value: &Value) -> String {
    let Some(text) = value_text(value) else { return "NULL".into() };
    let mut line = String::with_capacity(text.len().min(256));
    for (count, c) in text.chars().enumerate() {
        if count == 200 {
            line.push('…');
            break;
        }
        line.push(match c {
            '\n' => '↵',
            '\r' | '\t' => ' ',
            c => c,
        });
    }
    line
}

/// An ISO 8601 date or date and time, as `isIsoDate` takes it: `2024-01-15`, `2024-01-15T10:30`,
/// with optional seconds, fraction and `Z` or `±hh:mm` offset.
#[cfg(test)]
pub fn is_iso_date(text: &str) -> bool {
    parse_iso_date(text).is_some()
}

/// Seconds since the epoch between 2000 and 2100 (`isUnixTimestamp`).
pub fn is_unix_timestamp(value: f64) -> bool {
    (946_684_800. ..=4_102_444_800.).contains(&value)
}

fn parse_iso_date(text: &str) -> Option<DateTime<Utc>> {
    if !(10..=30).contains(&text.len()) || !text.is_ascii() {
        return None;
    }
    let digits = |range: std::ops::Range<usize>| text.get(range).is_some_and(|part| part.bytes().all(|byte| byte.is_ascii_digit()));
    if !(digits(0..4) && &text[4..5] == "-" && digits(5..7) && &text[7..8] == "-" && digits(8..10)) {
        return None;
    }
    if text.len() == 10 {
        // Date-only strings are UTC midnight, as `new Date("2024-01-15")`.
        return NaiveDate::parse_from_str(text, "%Y-%m-%d").ok()?.and_hms_opt(0, 0, 0).map(|time| time.and_utc());
    }
    let rest = text.strip_prefix(&text[..10])?.strip_prefix('T')?;
    let (time, offset) = match rest.strip_suffix('Z') {
        Some(time) => (time, Some(0)),
        None => match rest.rfind(['+', '-']) {
            Some(at) => {
                let (time, offset) = rest.split_at(at);
                let sign = if offset.starts_with('-') { -1 } else { 1 };
                let offset = offset[1..].replace(':', "");
                if offset.len() != 4 || !offset.bytes().all(|byte| byte.is_ascii_digit()) {
                    return None;
                }
                let (hours, minutes): (i32, i32) = (offset[..2].parse().ok()?, offset[2..].parse().ok()?);
                (time, Some(sign * (hours * 3600 + minutes * 60)))
            }
            None => (rest, None),
        },
    };
    let (clock, fraction) = time.split_once('.').map_or((time, None), |(clock, fraction)| (clock, Some(fraction)));
    if fraction.is_some_and(|fraction| fraction.is_empty() || !fraction.bytes().all(|byte| byte.is_ascii_digit())) || !matches!(clock.len(), 5 | 8) {
        return None;
    }
    if fraction.is_some() && clock.len() != 8 {
        return None;
    }
    let format = if clock.len() == 5 { "%Y-%m-%dT%H:%M" } else { "%Y-%m-%dT%H:%M:%S" };
    let naive = NaiveDateTime::parse_from_str(&format!("{}T{clock}", &text[..10]), format).ok()?;
    let naive = match fraction {
        Some(fraction) => {
            let nanos: u32 = format!("{:0<9}", &fraction[..fraction.len().min(9)]).parse().ok()?;
            naive.with_nanosecond(nanos)?
        }
        None => naive,
    };
    match offset {
        Some(seconds) => FixedOffset::east_opt(seconds)?.from_local_datetime(&naive).single().map(|time| time.with_timezone(&Utc)),
        // Without an offset the time is local, as in the original's `new Date`.
        None => Local.from_local_datetime(&naive).earliest().map(|time| time.with_timezone(&Utc)),
    }
}

/// `Jan 15, 2024, 10:30 AM` in the local time zone (`formatDate`).
fn format_date(time: DateTime<Utc>) -> String {
    time.with_timezone(&Local).format("%b %-d, %Y, %I:%M %p").to_string()
}

/// A date cell's text and tooltip: ISO dates and Unix timestamps read as local dates, the
/// tooltip keeping the raw value (`CellRenderer`'s date detection).
pub fn date_cell(value: &Value) -> Option<(String, String)> {
    match value {
        Value::String(text) => parse_iso_date(text).map(|time| (format_date(time), text.clone())),
        Value::Number(number) => {
            let seconds = number.as_f64().filter(|seconds| is_unix_timestamp(*seconds))?;
            let time = DateTime::from_timestamp_millis((seconds * 1000.) as i64)?;
            Some((format_date(time), format!("Raw: {number}")))
        }
        _ => None,
    }
}

/// Whether a column holds numbers, so its cells align right.
pub fn is_numeric_type(ty: &str) -> bool {
    let ty = ty.to_ascii_lowercase();
    ["int", "real", "float", "double", "decimal", "numeric", "serial", "number"].iter().any(|key| ty.contains(key))
}

/// What the row editor's text means for a column: a number for numeric columns when it parses,
/// a bool for boolean ones, else the text itself.
pub fn parse_input(text: &str, ty: &str) -> Value {
    let ty = ty.to_ascii_lowercase();
    if ty.contains("bool") {
        match text.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "t" | "yes" => return Value::Bool(true),
            "false" | "0" | "f" | "no" => return Value::Bool(false),
            _ => {}
        }
    }
    if is_numeric_type(&ty) {
        let trimmed = text.trim();
        if let Ok(int) = trimmed.parse::<i64>() {
            return Value::from(int);
        }
        if let Some(number) = trimmed.parse::<f64>().ok().and_then(serde_json::Number::from_f64) {
            return Value::Number(number);
        }
    }
    Value::String(text.to_string())
}

fn csv_field(text: &str) -> String {
    if text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_string()
    }
}

pub fn to_csv(result: &ResultSet) -> String {
    let mut out = unique_column_keys(&result.columns).iter().map(|column| csv_field(column)).collect::<Vec<_>>().join(",");
    for row in &result.rows {
        out.push('\n');
        out.push_str(&row.iter().map(|value| csv_field(&value_text(value).unwrap_or_default())).collect::<Vec<_>>().join(","));
    }
    out
}

/// One object per row, keyed by column. Repeated names (`a.id, b.id`) get `_2`, `_3`… and a
/// blank one `column_N`, as `uniqueColumnKeys` does, so no value overwrites another.
pub fn row_json(columns: &[String], row: &[Value]) -> Value {
    Value::Object(unique_column_keys(columns).into_iter().zip(row.iter().cloned()).collect())
}

pub fn unique_column_keys(columns: &[String]) -> Vec<String> {
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let base = match column.trim() {
                "" => format!("column_{}", index + 1),
                name => name.to_string(),
            };
            let count = seen.entry(base.clone()).or_insert(0);
            *count += 1;
            if *count == 1 { base } else { format!("{base}_{count}") }
        })
        .collect()
}

pub fn to_json(result: &ResultSet) -> String {
    let rows: Vec<Value> = result.rows.iter().map(|row| row_json(&result.columns, row)).collect();
    serde_json::to_string_pretty(&rows).unwrap_or_default()
}

/// A tab-separated copy of a row, as spreadsheets paste it.
pub fn to_tsv_row(row: &[Value]) -> String {
    row.iter().map(|value| value_text(value).unwrap_or_default().replace(['\t', '\n'], " ")).collect::<Vec<_>>().join("\t")
}

pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024. && unit < UNITS.len() - 1 {
        size /= 1024.;
        unit += 1;
    }
    if unit == 0 { format!("{bytes} B") } else { format!("{size:.1} {}", UNITS[unit]) }
}

pub fn format_count(count: u64) -> String {
    let digits = count.to_string();
    let mut out = String::new();
    for (ix, c) in digits.chars().enumerate() {
        if ix > 0 && (digits.len() - ix) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

pub fn format_elapsed(elapsed: std::time::Duration) -> String {
    let ms = elapsed.as_secs_f64() * 1000.;
    if ms < 1. {
        "<1 ms".into()
    } else if ms < 1000. {
        format!("{ms:.0} ms")
    } else {
        format!("{:.2} s", ms / 1000.)
    }
}

/// A JSON object or array (or text holding one) laid out with indentation, for the JSON viewer.
pub fn json_text(value: &Value) -> Option<String> {
    let parsed = match value {
        Value::Object(_) | Value::Array(_) => value.clone(),
        Value::String(text) => {
            let trimmed = text.trim();
            let wrapped = (trimmed.starts_with('{') && trimmed.ends_with('}')) || (trimmed.starts_with('[') && trimmed.ends_with(']'));
            if trimmed.len() < 2 || !wrapped {
                return None;
            }
            serde_json::from_str(trimmed).ok()?
        }
        _ => return None,
    };
    serde_json::to_string_pretty(&parsed).ok()
}
