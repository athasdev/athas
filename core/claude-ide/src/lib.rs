//! The editor side of Claude Code's IDE integration (`/ide`): a localhost WebSocket server that
//! speaks MCP, advertised to `claude` through a lock file under `~/.claude/ide`.

pub mod auth;
pub mod host;
pub mod lock_file;
pub mod protocol;
pub mod selection;
pub mod server;

pub use host::{BridgeEvent, FrontendBridge, IdeHost, ToolAnswer, ToolError, ToolRequest};
pub use lock_file::default_lock_dir;
pub use selection::{EditorSelection, SelectionPosition};
pub use server::{ENABLE_ENV, IdeServer, IdeServerConfig, PORT_ENV};
