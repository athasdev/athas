//! The GitHub client the panel calls. On the desktop these are the old app's `athas-github`
//! functions themselves; on the web they are [`crate::relay`]'s, which ask the workspace server to
//! make the same calls with its token, and the types are the same definitions compiled from the
//! crate's sources.

#[cfg(not(target_family = "wasm"))]
pub use athas_github::*;

#[cfg(target_family = "wasm")]
pub use crate::{models::*, relay::*, wire::*};
