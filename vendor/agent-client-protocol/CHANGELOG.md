# Changelog

## [0.9.2](https://github.com/agentclientprotocol/rust-sdk/compare/v0.9.1...v0.9.2) - 2025-12-17

### Added

- *(unstable)* Add initial support for session config options ([#36](https://github.com/agentclientprotocol/rust-sdk/pull/36))

## [0.9.1](https://github.com/agentclientprotocol/rust-sdk/compare/v0.9.0...v0.9.1) - 2025-12-17

### Added

- *(unstable)* Add initial support for resuming sessions ([#34](https://github.com/agentclientprotocol/rust-sdk/pull/34))
- *(unstable)* Add initial support for forking sessions ([#33](https://github.com/agentclientprotocol/rust-sdk/pull/33))
- *(unstable)* Add initial support for listing sessions ([#31](https://github.com/agentclientprotocol/rust-sdk/pull/31))

### Other

- Add test for unstable session info feature ([#35](https://github.com/agentclientprotocol/rust-sdk/pull/35))

## [0.9.0](https://github.com/agentclientprotocol/rust-sdk/compare/v0.8.0...v0.9.0) - 2025-12-08

Update to v0.10.0 of agent-client-protocol-schema

## 0.8.0 (2025-12-01)

The types from the Rust crate, `agent-client-protocol-schema` has major breaking changes. All exported type are now marked as `#[non_exhaustive]`. Since the schema itself is JSON, and we can introduce new fields and variants in a non-breaking way, we wanted to allow for the same behavior in the Rust library.

All enum variants are also tuple variants now, with their own structs. This made it nicer to represent in the JSON Schema, and also made sure we have `_meta` fields on all variants.

This upgrade will likely come with a lot of compilation errors, but ideally upgrading will be more painless in the future.

## 0.7.0 (2025-10-24)

- Add ability for agents and clients to provide information about their implementation
- Fix incorrectly serialized `_meta` field on `SetSessionModeResponse`

## 0.6.0 (2025-10-23)

- Provide missing `_meta` fields on certain enum variants.
- More consistent enum usage. Enums are always either newtype or struct variants within a single enum, not mixed.

## 0.5.0 (2025-10-20)

- Export necessary RPC types. Fixes an issue where certain fields weren't public enough.
- Make id types easier to create and add `PartialEq` and `Eq` impls for as many types as possible.
- Export `acp::Result<T, E = acp::Error>` for easier indication of ACP errors.
- Use `acp::Error`/`acp::Result` instead of `anyhow::Error`/`anyhow::Result` for all return types.

## 0.4.7 (2025-10-13)

- Depend on `agent-client-protocol-schema` for schema types

## 0.4.6 (2025-10-10)

### Rust

- Fix: support all valid JSON-RPC ids (int, string, null)

## 0.4.5 (2025-10-02)

- No changes

## 0.4.4 (2025-09-30)

- Provide default trait implementations for optional capability-based `Agent` and `Client` methods.

## 0.4.3 (2025-09-25)

- impl `Agent` and `Client` for `Rc<T>` and `Arc<T>` where `T` implements either trait.

## 0.4.2 (2025-09-22)

**Unstable** fix missing method for model selection in Rust library.

## 0.4.1 (2025-09-22)

**Unstable** initial support for model selection.

## 0.4.0 (2025-09-17)

- Make `Agent` and `Client` dyn compatible (you'll need to annotate them with `#[async_trait]`) [#97](https://github.com/agentclientprotocol/agent-client-protocol/pull/97)
- `ext_method` and `ext_notification` methods are now more consistent with the other trait methods [#95](https://github.com/agentclientprotocol/agent-client-protocol/pull/95)
  - There are also distinct types for `ExtRequest`, `ExtResponse`, and `ExtNotification`
- Rexport `serde_json::RawValue` for easier use [#95](https://github.com/agentclientprotocol/agent-client-protocol/pull/95)
