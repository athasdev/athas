use serde::{Deserialize, Serialize};

/// Semantic tokens sent to the webview as a raw `ArrayBuffer`; the layout is documented on
/// [`athas_lsp::flat::encode_semantic_tokens_payload`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticTokensPayload(pub Vec<u8>);

impl tauri::ipc::IpcResponse for SemanticTokensPayload {
   fn body(self) -> tauri::Result<tauri::ipc::InvokeResponseBody> {
      Ok(tauri::ipc::InvokeResponseBody::Raw(self.0))
   }
}

impl specta::Type for SemanticTokensPayload {
   fn definition(_: &mut specta::Types) -> specta::datatype::DataType {
      specta::datatype::DataType::Reference(specta_typescript::define("ArrayBuffer"))
   }
}

/// An `lsp_types` value crossing IPC unchanged. The generated bindings type it as
/// the matching `vscode-languageserver-protocol` type the frontend already uses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Lsp<T>(pub T);

pub trait LspTypeName {
   const TS_NAME: &'static str;
}

macro_rules! lsp_type_names {
   ($($ty:ident => $name:literal),* $(,)?) => {
      $(impl LspTypeName for lsp_types::$ty {
         const TS_NAME: &'static str = $name;
      })*
   };
}

lsp_type_names!(
   CallHierarchyIncomingCall => "CallHierarchyIncomingCall",
   CallHierarchyItem => "CallHierarchyItem",
   CallHierarchyOutgoingCall => "CallHierarchyOutgoingCall",
   CompletionItem => "CompletionItem",
   DocumentHighlight => "DocumentHighlight",
   FoldingRange => "FoldingRange",
   Hover => "Hover",
   Location => "Location",
   Position => "Position",
   PrepareRenameResponse => "PrepareRenameResult",
   SelectionRange => "SelectionRange",
   SignatureHelp => "SignatureHelp",
   TextEdit => "TextEdit",
   TypeHierarchyItem => "TypeHierarchyItem",
   WorkspaceEdit => "WorkspaceEdit",
);

impl<T: LspTypeName> specta::Type for Lsp<T> {
   fn definition(_: &mut specta::Types) -> specta::datatype::DataType {
      specta::datatype::DataType::Reference(specta_typescript::define(format!(
         "Lsp.{}",
         T::TS_NAME
      )))
   }
}

/// Wraps `lsp_types` values, including inside `Option` and `Vec`, in [`Lsp`].
pub trait IntoLsp {
   type Output;
   fn into_lsp(self) -> Self::Output;
}

impl<T: LspTypeName> IntoLsp for T {
   type Output = Lsp<T>;
   fn into_lsp(self) -> Self::Output {
      Lsp(self)
   }
}

impl<T: IntoLsp> IntoLsp for Option<T> {
   type Output = Option<T::Output>;
   fn into_lsp(self) -> Self::Output {
      self.map(IntoLsp::into_lsp)
   }
}

impl<T: IntoLsp> IntoLsp for Vec<T> {
   type Output = Vec<T::Output>;
   fn into_lsp(self) -> Self::Output {
      self.into_iter().map(IntoLsp::into_lsp).collect()
   }
}
