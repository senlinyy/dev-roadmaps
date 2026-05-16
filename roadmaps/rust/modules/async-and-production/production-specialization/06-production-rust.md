---
title: "Production Rust"
description: "Shape longer-lived Rust projects with workspaces, domain errors, tracing, configuration, dependency review, and release checks."
overview: "Production Rust is less about exotic language features and more about making ownership, errors, logs, configuration, and project boundaries hold up over time."
tags: ["production", "workspaces", "tracing", "errors"]
order: 2
id: article-rust-async-and-production-production-rust
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Project Boundaries](#project-boundaries)
3. [Error Layers](#error-layers)
4. [Tracing](#tracing)
5. [Configuration](#configuration)
6. [Dependencies And Features](#dependencies-and-features)
7. [Release Checks](#release-checks)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

The notes app has become a service used by other people. Now the hard parts are not only language features.

Production pressure asks different questions:

- Can a teammate understand which crate owns which job?
- Can operators see why a request failed?
- Can errors keep source detail without leaking internals everywhere?
- Can builds stay repeatable as dependencies grow?

Production Rust is not a bag of advanced tricks. It is ordinary Rust habits made durable: clear boundaries, structured errors, useful telemetry, explicit config, and repeatable checks.

## Project Boundaries

Small projects can live in one crate. Larger projects often split into a workspace.

```text
notes-service/
  Cargo.toml
  crates/
    notes-core/
    notes-api/
    notes-cli/
```

The workspace root coordinates related packages. The crates inside still declare their dependencies explicitly.

Use boundaries to separate jobs:

| Crate | Job |
| --- | --- |
| `notes-core` | Domain types, parsing, indexing |
| `notes-api` | HTTP routes and service wiring |
| `notes-cli` | Terminal commands and user output |

Do not split crates just to look serious. Split when independent ownership, compile times, dependency boundaries, or reuse make the separation pay for itself.

:::expand[Workspaces are coordination, not architecture by themselves]{kind="design"}
A Cargo workspace gives related packages one shared build area and one shared `Cargo.lock`. That helps crates developed together stay coordinated.

It does not decide your architecture for you.

This workspace shape can be clean:

```text
crates/
  notes-core/
  notes-api/
  notes-cli/
```

It is clean only if the dependencies point in a sensible direction. For example, `notes-api` and `notes-cli` can both depend on `notes-core`. `notes-core` should not depend on `notes-api`, because the domain model should not need the HTTP layer.

Use this review habit:

| Question | Good signal |
| --- | --- |
| Can this crate be explained in one sentence? | Boundary is probably meaningful |
| Does it avoid depending on higher-level crates? | Direction is healthy |
| Does it hide dependencies not needed elsewhere? | Boundary reduces coupling |
| Is it split only because the project feels big? | Wait longer |

Workspaces help manage related crates. They do not replace simple dependency direction.
:::

## Error Layers

Production code often uses different error shapes at different layers.

At the domain boundary, use specific errors:

```rust
#[derive(Debug, thiserror::Error)]
pub enum NoteError {
    #[error("note title is missing")]
    MissingTitle,

    #[error("could not read note file")]
    Read(#[from] std::io::Error),
}
```

For application wiring, a broader error type can be useful:

```rust
fn main() -> anyhow::Result<()> {
    run_notes_cli()?;
    Ok(())
}
```

The rough rule is: libraries should expose errors callers can reason about; applications can often use a flexible error type at the top level.

Keep the source error alive where it helps debugging. Convert to human text at the edge.

## Tracing

Logs answer "what happened?" Tracing also answers "inside which operation did it happen?"

The `tracing` crate uses spans for work that has duration and events for moments in time.

```rust
use tracing::{info, instrument};

#[instrument(skip(body))]
fn index_note(id: u64, body: &str) {
    let words = body.split_whitespace().count();
    info!(words, "indexed note");
}
```

The span can carry the note ID. The event can carry the word count. That is more useful than a plain string log because tools can filter, group, and search structured fields.

The production habit is to log decisions and boundaries, not every line. Trace request IDs, user-safe resource IDs, retry decisions, and important state changes.

## Configuration

Production programs need configuration: bind address, database URL, log level, feature toggles, timeouts.

Avoid scattering environment reads throughout the code. Load configuration once, validate it, and pass a typed config value into the parts that need it.

```rust
struct AppConfig {
    bind_addr: String,
    request_timeout_ms: u64,
}

impl AppConfig {
    fn from_env() -> Result<Self, ConfigError> {
        Ok(Self {
            bind_addr: std::env::var("BIND_ADDR")?,
            request_timeout_ms: std::env::var("REQUEST_TIMEOUT_MS")?.parse()?,
        })
    }
}
```

This keeps the rest of the app from repeatedly asking the operating system for strings and parsing them at random points.

## Dependencies And Features

Rust projects can accumulate dependencies quickly. Cargo gives you tools to inspect the graph.

```bash
cargo tree
cargo tree -d
cargo tree -e features
```

`cargo tree` shows the dependency graph. The duplicate view helps find multiple versions of the same crate. The feature view helps explain why a dependency is compiled with certain optional behavior.

Feature flags are powerful, but they are part of your public build surface. Use them deliberately:

```toml
[features]
default = ["sqlite"]
sqlite = ["dep:sqlx"]
```

Do not add features as a place to hide unclear design. A feature should correspond to a real build choice.

## Release Checks

A production Rust project should have a small repeatable check set:

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
cargo build --release
cargo doc --no-deps
cargo tree
```

The exact commands may differ by project, but each one answers a real question:

| Command | Question |
| --- | --- |
| `cargo fmt` | Is formatting stable? |
| `cargo clippy` | Did common mistakes slip in? |
| `cargo test` | Does behavior still hold? |
| `cargo build --release` | Does optimized production build work? |
| `cargo doc` | Do public docs build? |
| `cargo tree` | Do dependencies look understandable? |

This is not bureaucracy. It is a way to catch boring failures before they become expensive.

## Putting It All Together

The production notes service has a clear shape:

```text
notes-service/
  Cargo.toml
  crates/
    notes-core/
      src/error.rs
      src/index.rs
      src/parser.rs
    notes-api/
      src/config.rs
      src/routes.rs
    notes-cli/
      src/main.rs
```

`notes-core` owns domain behavior. `notes-api` owns service wiring and observability. `notes-cli` owns terminal output. Errors keep source detail. Config is loaded once. Tracing records request-shaped work. Cargo checks keep the project reviewable.

Count back to the opener:

- Boundaries explain ownership.
- Error layers preserve useful detail.
- Tracing gives operational evidence.
- Config becomes typed input.
- Dependency and release checks become routine.

Production Rust is Rust with a longer memory. The code should still be explicit, but the project now needs to be explicit about operations too.

## What's Next

The last article in the Rust roadmap helps you choose a direction. The same foundation can lead to backend services, CLI tools, embedded systems, systems programming, WebAssembly, or data and performance work.

---

**References**

- [Cargo Workspaces - The Rust Programming Language](https://doc.rust-lang.org/book/ch14-03-cargo-workspaces.html)
- [cargo tree - The Cargo Book](https://doc.rust-lang.org/cargo/commands/cargo-tree.html)
- [tracing - Rust documentation](https://docs.rs/tracing/latest/tracing/)
- [thiserror - Rust documentation](https://docs.rs/thiserror/latest/thiserror/)
- [anyhow - Rust documentation](https://docs.rs/anyhow/latest/anyhow/)
