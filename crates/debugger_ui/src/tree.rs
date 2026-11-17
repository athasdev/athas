//! The variables and watch trees, flattened into rows. Expansion is keyed by the names on the path
//! (`Locals/user/'name'`) rather than by the adapter's references, which change at every stop, so
//! an expanded variable stays open while stepping.

use std::collections::HashMap;

use dap::{DebugSession, Loadable, Variable};

/// Deeper than this is almost always a reference cycle.
const MAX_DEPTH: usize = 16;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum RowKind {
    Scope,
    Variable { value: String, kind: Option<String> },
    Loading,
    Failed(String),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TreeRow {
    pub key: String,
    pub depth: usize,
    pub name: String,
    pub kind: RowKind,
    /// The adapter's handle for the children, or 0 for a leaf.
    pub reference: i64,
    /// The handle of the scope or value this row belongs to, which `setVariable` names.
    pub parent: i64,
    pub expanded: bool,
}

/// Which rows are open. Scopes start open unless the adapter marks them expensive.
#[derive(Default)]
pub(crate) struct Expansion(HashMap<String, bool>);

impl Expansion {
    pub fn is_expanded(&self, key: &str, default: bool) -> bool {
        self.0.get(key).copied().unwrap_or(default)
    }

    pub fn set(&mut self, key: String, expanded: bool) {
        self.0.insert(key, expanded);
    }
}

/// The selected frame's scopes and their open variables. `missing` gets the references of open
/// rows whose children have not been asked for yet.
pub(crate) fn scope_rows(session: &DebugSession, expansion: &Expansion, missing: &mut Vec<i64>) -> Vec<TreeRow> {
    let mut rows = Vec::new();
    for scope in session.scopes() {
        let key = format!("scope/{}", scope.name);
        let expanded = expansion.is_expanded(&key, !scope.expensive);
        rows.push(TreeRow {
            key: key.clone(),
            depth: 0,
            name: scope.name.clone(),
            kind: RowKind::Scope,
            reference: scope.variables_reference,
            parent: 0,
            expanded,
        });
        if expanded {
            push_children(session, scope.variables_reference, &key, 1, expansion, &mut rows, missing);
        }
    }
    rows
}

/// The children of an open row (a watch result, a variable), below it at `depth`.
pub(crate) fn push_children(
    session: &DebugSession,
    reference: i64,
    parent_key: &str,
    depth: usize,
    expansion: &Expansion,
    rows: &mut Vec<TreeRow>,
    missing: &mut Vec<i64>,
) {
    if reference <= 0 || depth > MAX_DEPTH {
        return;
    }
    let placeholder = |kind: RowKind| TreeRow { key: format!("{parent_key}/…"), depth, name: String::new(), kind, reference: 0, parent: reference, expanded: false };
    match session.variables(reference) {
        None => {
            missing.push(reference);
            rows.push(placeholder(RowKind::Loading));
        }
        Some(Loadable::Loading) => rows.push(placeholder(RowKind::Loading)),
        Some(Loadable::Failed(error)) => rows.push(placeholder(RowKind::Failed(error.clone()))),
        Some(Loadable::Loaded(variables)) => {
            for variable in variables {
                push_variable(session, variable, reference, parent_key, depth, expansion, rows, missing);
            }
        }
    }
}

fn push_variable(
    session: &DebugSession,
    variable: &Variable,
    parent: i64,
    parent_key: &str,
    depth: usize,
    expansion: &Expansion,
    rows: &mut Vec<TreeRow>,
    missing: &mut Vec<i64>,
) {
    let key = format!("{parent_key}/{}", variable.name);
    let expanded = variable.variables_reference > 0 && expansion.is_expanded(&key, false);
    rows.push(TreeRow {
        key: key.clone(),
        depth,
        name: variable.name.clone(),
        kind: RowKind::Variable { value: variable.value.clone(), kind: variable.kind.clone() },
        reference: variable.variables_reference,
        parent,
        expanded,
    });
    if expanded {
        push_children(session, variable.variables_reference, &key, depth + 1, expansion, rows, missing);
    }
}
