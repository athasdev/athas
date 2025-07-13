use rusqlite::Connection;
use tauri::command;

#[derive(serde::Serialize)]
pub struct TableInfo {
    pub name: String,
}

#[derive(serde::Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

#[command]
pub fn get_sqlite_tables(path: String) -> Result<Vec<TableInfo>, String> {
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map_err(|e| e.to_string())?;

    let table_iter = stmt
        .query_map([], |row| Ok(TableInfo { name: row.get(0)? }))
        .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    for table in table_iter {
        tables.push(table.map_err(|e| e.to_string())?);
    }

    Ok(tables)
}

#[command]
pub fn query_sqlite(path: String, query: String) -> Result<QueryResult, String> {
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let column_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();

    let mut rows = Vec::new();
    let mut row_iter = stmt.query([]).map_err(|e| e.to_string())?;

    while let Some(row) = row_iter.next().map_err(|e| e.to_string())? {
        let mut row_data = Vec::new();

        for i in 0..column_names.len() {
            let value = match row.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                Ok(rusqlite::types::ValueRef::Integer(i)) => serde_json::Value::Number(i.into()),
                Ok(rusqlite::types::ValueRef::Real(f)) => {
                    if let Some(n) = serde_json::Number::from_f64(f) {
                        serde_json::Value::Number(n)
                    } else {
                        serde_json::Value::String(f.to_string())
                    }
                }
                Ok(rusqlite::types::ValueRef::Text(t)) => {
                    serde_json::Value::String(String::from_utf8_lossy(t).to_string())
                }
                Ok(rusqlite::types::ValueRef::Blob(b)) => {
                    let hex_string = b
                        .iter()
                        .map(|byte| format!("{byte:02X}"))
                        .collect::<Vec<String>>()
                        .join("");
                    serde_json::Value::String(format!("BLOB({hex_string})"))
                }
                Err(_) => serde_json::Value::Null,
            };

            row_data.push(value);
        }

        rows.push(row_data);
    }

    Ok(QueryResult {
        columns: column_names,
        rows,
    })
}
