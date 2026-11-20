//! Debugging through the Debug Adapter Protocol (`features/debugger` and `crates/debugger` of the
//! Tauri app): the wire framing, a client for adapters over stdio or TCP, adapter discovery among
//! installed tools, `.vscode/launch.json`, the shared [`BreakpointStore`], and [`DebugSession`],
//! which runs one session from the handshake to the end.

mod adapters;
mod breakpoints;
mod client;
mod launch;
mod session;
#[cfg(any(test, feature = "test-support"))]
pub mod testing;
pub mod transport;
mod types;

pub use adapters::{Adapter, Connection, find_executable, installed as installed_adapters, resolve as resolve_adapter};
pub use breakpoints::{
    Breakpoint, BreakpointField, BreakpointId, BreakpointState, BreakpointStore, BreakpointStoreEvent, ExecutionPosition,
};
pub use client::{AdapterCommand, DapClient, Incoming};
pub use launch::{
    ConfigSource, LaunchConfig, RequestKind, Substitutions, generated_configs, load_workspace_configs, parse_launch_json, strip_jsonc,
};
pub use session::{
    DebugSession, Loadable, OutputCategory, OutputLine, RunInTerminal, RunInTerminalHandler, SessionEvent, SessionStatus, StopInfo,
};
pub use types::{BreakpointResult, Capabilities, EvaluateResult, ExceptionFilter, Scope, Source, StackFrame, Thread, Variable};
