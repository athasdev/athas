//! Handler types for building custom JSON-RPC message handlers.
//!
//! This module contains the handler types used by [`Builder`](crate::Builder)
//! to process incoming messages. Most users won't need to use these types directly,
//! as the builder methods on `Builder` handle the construction automatically.

pub use crate::jsonrpc::{HandleDispatchFrom, handlers::NullHandler};
