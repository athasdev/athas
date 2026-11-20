//! Workspace edits (rename, code actions, `workspace/applyEdit`) flattened into file operations.

use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use lsp_types::{DocumentChangeOperation, DocumentChanges, OneOf, ResourceOp, TextEdit, WorkspaceEdit};

use crate::text::apply_text_edits;

#[derive(Clone, Debug, PartialEq)]
pub enum FileOperation {
    Edit { path: PathBuf, edits: Vec<TextEdit> },
    Create { path: PathBuf, overwrite: bool },
    Rename { from: PathBuf, to: PathBuf, overwrite: bool },
    Delete { path: PathBuf, recursive: bool },
}

/// The operations of an edit in the order they apply. Edits to one file are merged.
pub fn operations(edit: &WorkspaceEdit) -> Vec<FileOperation> {
    let mut operations: Vec<FileOperation> = Vec::new();
    let push_edits = |operations: &mut Vec<FileOperation>, path: PathBuf, edits: Vec<TextEdit>| {
        if let Some(FileOperation::Edit { edits: existing, .. }) =
            operations.iter_mut().rev().find(|operation| matches!(operation, FileOperation::Edit { path: other, .. } if *other == path))
        {
            existing.extend(edits);
        } else {
            operations.push(FileOperation::Edit { path, edits });
        }
    };
    let text_edits = |edits: &[OneOf<TextEdit, lsp_types::AnnotatedTextEdit>]| -> Vec<TextEdit> {
        edits
            .iter()
            .map(|edit| match edit {
                OneOf::Left(edit) => edit.clone(),
                OneOf::Right(annotated) => annotated.text_edit.clone(),
            })
            .collect()
    };
    match &edit.document_changes {
        Some(DocumentChanges::Edits(edits)) => {
            for edit in edits {
                if let Some(path) = crate::uri::to_path(&edit.text_document.uri) {
                    push_edits(&mut operations, path, text_edits(&edit.edits));
                }
            }
        }
        Some(DocumentChanges::Operations(changes)) => {
            for change in changes {
                match change {
                    DocumentChangeOperation::Edit(edit) => {
                        if let Some(path) = crate::uri::to_path(&edit.text_document.uri) {
                            push_edits(&mut operations, path, text_edits(&edit.edits));
                        }
                    }
                    DocumentChangeOperation::Op(ResourceOp::Create(create)) => {
                        if let Some(path) = crate::uri::to_path(&create.uri) {
                            let overwrite = create.options.as_ref().and_then(|options| options.overwrite).unwrap_or(false);
                            operations.push(FileOperation::Create { path, overwrite });
                        }
                    }
                    DocumentChangeOperation::Op(ResourceOp::Rename(rename)) => {
                        if let (Some(from), Some(to)) = (crate::uri::to_path(&rename.old_uri), crate::uri::to_path(&rename.new_uri)) {
                            let overwrite = rename.options.as_ref().and_then(|options| options.overwrite).unwrap_or(false);
                            operations.push(FileOperation::Rename { from, to, overwrite });
                        }
                    }
                    DocumentChangeOperation::Op(ResourceOp::Delete(delete)) => {
                        if let Some(path) = crate::uri::to_path(&delete.uri) {
                            let recursive = delete.options.as_ref().and_then(|options| options.recursive).unwrap_or(false);
                            operations.push(FileOperation::Delete { path, recursive });
                        }
                    }
                }
            }
        }
        None => {
            let mut changes: Vec<_> = edit.changes.iter().flatten().collect();
            changes.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));
            for (uri, edits) in changes {
                if let Some(path) = crate::uri::to_path(&uri) {
                    push_edits(&mut operations, path, edits.clone());
                }
            }
        }
    }
    operations
}

/// Applies an operation to the disk (a file no editor has open).
pub fn apply_on_disk(operation: &FileOperation) -> Result<()> {
    match operation {
        FileOperation::Edit { path, edits } => {
            let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
            let edited = apply_text_edits(&text, edits);
            // Checked against the text just read (`workspace-edit.ts` writes with `entry.content`):
            // a file changed in between is refused; a symlink, BOM and permissions survive.
            #[cfg(not(target_family = "wasm"))]
            {
                let expected = athas_project::local_fs::ExpectedFileDigest::of(&text);
                athas_project::local_fs::write_text_checked(path, Some(expected), edited).map_err(|error| anyhow::anyhow!("writing {}: {error}", path.display()))
            }
            #[cfg(target_family = "wasm")]
            std::fs::write(path, edited).with_context(|| format!("writing {}", path.display()))
        }
        FileOperation::Create { path, overwrite } => {
            if path.exists() && !overwrite {
                return Ok(());
            }
            create_parent(path)?;
            std::fs::write(path, "").with_context(|| format!("creating {}", path.display()))
        }
        FileOperation::Rename { from, to, overwrite } => {
            if to.exists() && !overwrite {
                anyhow::bail!("{} already exists", to.display());
            }
            create_parent(to)?;
            std::fs::rename(from, to).with_context(|| format!("renaming {}", from.display()))
        }
        FileOperation::Delete { path, recursive } => {
            if path.is_dir() {
                if *recursive { std::fs::remove_dir_all(path) } else { std::fs::remove_dir(path) }
            } else {
                std::fs::remove_file(path)
            }
            .with_context(|| format!("deleting {}", path.display()))
        }
    }
}

fn create_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use lsp_types::{OptionalVersionedTextDocumentIdentifier, Position, Range, RenameFile, TextDocumentEdit, Url};

    use super::*;

    fn edit(line: u32, text: &str) -> TextEdit {
        TextEdit::new(Range::new(Position::new(line, 0), Position::new(line, 1)), text.into())
    }

    #[test]
    fn flattens_changes_and_operations() {
        let a = Url::from_file_path("/p/a.rs").unwrap();
        let b = Url::from_file_path("/p/b.rs").unwrap();
        let changes = WorkspaceEdit { changes: Some(HashMap::from([(b.clone(), vec![edit(0, "x")]), (a.clone(), vec![edit(1, "y")])])), ..Default::default() };
        assert_eq!(
            operations(&changes),
            vec![
                FileOperation::Edit { path: "/p/a.rs".into(), edits: vec![edit(1, "y")] },
                FileOperation::Edit { path: "/p/b.rs".into(), edits: vec![edit(0, "x")] },
            ]
        );
        let document_edit = |uri: &Url, edits: Vec<TextEdit>| TextDocumentEdit {
            text_document: OptionalVersionedTextDocumentIdentifier { uri: uri.clone(), version: None },
            edits: edits.into_iter().map(OneOf::Left).collect(),
        };
        let operations_edit = WorkspaceEdit {
            document_changes: Some(DocumentChanges::Operations(vec![
                DocumentChangeOperation::Edit(document_edit(&a, vec![edit(0, "1")])),
                DocumentChangeOperation::Op(ResourceOp::Rename(RenameFile { old_uri: b.clone(), new_uri: Url::from_file_path("/p/c.rs").unwrap(), options: None, annotation_id: None })),
                DocumentChangeOperation::Edit(document_edit(&a, vec![edit(2, "2")])),
            ])),
            ..Default::default()
        };
        assert_eq!(
            operations(&operations_edit),
            vec![
                FileOperation::Edit { path: "/p/a.rs".into(), edits: vec![edit(0, "1"), edit(2, "2")] },
                FileOperation::Rename { from: "/p/b.rs".into(), to: "/p/c.rs".into(), overwrite: false },
            ]
        );
    }

    #[test]
    fn applies_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "abc\ndef\n").unwrap();
        apply_on_disk(&FileOperation::Edit { path: path.clone(), edits: vec![edit(1, "X")] }).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "abc\nXef\n");
        let moved = dir.path().join("sub/b.txt");
        apply_on_disk(&FileOperation::Rename { from: path.clone(), to: moved.clone(), overwrite: false }).unwrap();
        assert!(moved.exists() && !path.exists());
        apply_on_disk(&FileOperation::Delete { path: moved.clone(), recursive: false }).unwrap();
        assert!(!moved.exists());
    }
}
