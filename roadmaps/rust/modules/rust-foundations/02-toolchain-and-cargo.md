---
title: "Cargo Workflow"
description: "Install Rust, create a Cargo project, and use the everyday commands for checking, running, testing, formatting, linting, and documenting code."
overview: "Rust projects are normally managed with Cargo. This article explains the toolchain and the daily command loop a beginner uses before reading larger programs."
tags: ["cargo", "rustup", "workflow", "toolchain"]
order: 2
id: article-rust-rust-foundations-toolchain-and-cargo
aliases:
  - toolchain-and-cargo
  - rust-workflow
  - rust-foundations/02-toolchain-and-cargo.md
  - rust-foundations/context-and-workflow/02-toolchain-and-cargo.md
  - rust-foundations/rust-context/02-toolchain-and-cargo.md
  - roadmaps/rust/modules/rust-foundations/context-and-workflow/02-toolchain-and-cargo.md
  - child-context-and-workflow-02-toolchain-and-cargo
---

## Table of Contents

1. [What Is the Rust Toolchain?](#what-is-the-rust-toolchain)
2. [Installing Rust With rustup](#installing-rust-with-rustup)
3. [First Project](#first-project)
4. [The Daily Loop](#the-daily-loop)
5. [Manifest And Lockfile](#manifest-and-lockfile)
6. [Formatting, Linting, And Testing](#formatting-linting-and-testing)
7. [Dependencies And Docs](#dependencies-and-docs)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Is the Rust Toolchain?

If you are coming from JavaScript, you may be used to installing Node.js, npm, a formatter, a linter, a test runner, and a bundler as separate pieces. Rust has several tools too, but the default workflow is more unified. The main tools are installed and updated together.

The Rust toolchain is the set of programs that let you compile, run, format, lint, test, document, and publish Rust code. Most beginners meet these names quickly:

| Tool | What it does | When you notice it |
| --- | --- | --- |
| `rustc` | Compiles Rust source code | Cargo calls it during builds. |
| `cargo` | Creates projects, builds code, runs tests, manages dependencies | You use it every day. |
| `rustup` | Installs and updates Rust toolchains | You use it during setup and upgrades. |
| `rustfmt` | Formats Rust source code | `cargo fmt` calls it. |
| `clippy` | Finds common mistakes and suspicious patterns | `cargo clippy` calls it. |
| `rustdoc` | Builds documentation from Rust code and comments | `cargo doc` calls it. |

You can compile a single Rust file with `rustc`, but most Rust work uses Cargo. Cargo knows the package layout, dependency graph, build profiles, test targets, examples, and documentation output. That makes the workflow more like entering a project directory and asking one tool to do the right thing.

## Installing Rust With rustup

The standard installation path uses `rustup`. It installs the Rust toolchain for your user account and lets you update it later.

After installation, these commands are the quick sanity check:

```bash
$ rustc --version
rustc 1.85.0 (4d91de4e4 2025-02-17)

$ cargo --version
cargo 1.85.0 (d73d2caf9 2024-12-31)

$ rustup show
Default host: x86_64-unknown-linux-gnu
rustup home:  /home/you/.rustup

installed toolchains
--------------------
stable-x86_64-unknown-linux-gnu (default)
```

The exact version numbers will differ on your machine. The useful check is that `rustc`, `cargo`, and `rustup` all respond. If your shell says `command not found`, the tools are either not installed or the Cargo binary directory is not on your `PATH`.

The "default host" line names the platform Rust is set up to build for by default. The triple `x86_64-unknown-linux-gnu` means x86-64 CPU, Linux operating system, and the GNU C library environment. You do not need to memorize target triples on day one. You only need to know that Rust is always compiling for some target.

`rustup update` updates the installed toolchains:

```bash
$ rustup update
info: syncing channel updates for 'stable-x86_64-unknown-linux-gnu'
info: checking for self-update
  stable-x86_64-unknown-linux-gnu unchanged - rustc 1.85.0
```

Rust has stable, beta, and nightly channels. Most learning and production work should start on stable. Nightly is useful when a project deliberately depends on experimental compiler features, but that is a later decision.

## First Project

Cargo creates the standard project shape for you. Start in a workspace directory, then run `cargo new`:

```bash
$ cargo new notes-cli
    Creating binary (application) `notes-cli` package
$ cd notes-cli
$ tree -L 2
.
├── Cargo.toml
└── src
    └── main.rs
```

Cargo created a package named `notes-cli`. A package is the unit described by `Cargo.toml`. The `src/main.rs` file is the root of a binary crate, which means it builds an executable program.

Open the generated source file:

```rust
fn main() {
    println!("Hello, world!");
}
```

Rust programs that run as executables start at a function named `main`. The line `println!("Hello, world!");` calls a macro that prints text followed by a newline. The exclamation point is part of the macro call syntax. Macros are covered lightly in the next article; for now, read `println!` as the normal Rust way to print formatted output.

Run the program:

```bash
$ cargo run
   Compiling notes-cli v0.1.0 (/home/you/notes-cli)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.42s
     Running `target/debug/notes-cli`
Hello, world!
```

Cargo did several things here. It compiled the package, wrote build output under `target/debug/`, ran the binary, and printed the program output. The `dev` profile means this was a normal development build with debug information and without release optimization.

The `target/` directory is managed by Cargo. You usually do not edit it. If it gets large or stale, it can be deleted and rebuilt.

## The Daily Loop

The daily Rust loop is usually `edit`, `cargo check`, `cargo test`, and `cargo run`. Each command answers a different question.

`cargo check` is the fastest first pass:

```bash
$ cargo check
    Checking notes-cli v0.1.0 (/home/you/notes-cli)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.10s
```

This asks Rust to check the project without producing the final binary. It still runs the type checker and borrow checker. That makes it useful while editing because it catches many mistakes quickly.

`cargo build` compiles the project and leaves the binary on disk:

```bash
$ cargo build
   Compiling notes-cli v0.1.0 (/home/you/notes-cli)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.36s

$ ./target/debug/notes-cli
Hello, world!
```

`cargo run` combines build and execute. It is convenient for applications and examples:

```bash
$ cargo run -- --help
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.02s
     Running `target/debug/notes-cli --help`
Hello, world!
```

The `--` separates arguments for Cargo from arguments for your program. In this example, `--help` is passed to `notes-cli`, not to Cargo. That separator becomes important once your program accepts command-line options.

`cargo build --release` creates an optimized build:

```bash
$ cargo build --release
   Compiling notes-cli v0.1.0 (/home/you/notes-cli)
    Finished `release` profile [optimized] target(s) in 0.55s
```

Release builds take longer because the compiler spends more time optimizing machine code. Development builds keep iteration fast. This split is one reason Cargo has build profiles.

Here is the basic command map:

| Command | Question it answers |
| --- | --- |
| `cargo check` | Does the code compile cleanly enough to keep editing? |
| `cargo build` | Can Cargo produce a development binary? |
| `cargo run` | What happens when this binary runs? |
| `cargo build --release` | Can Cargo produce an optimized binary? |
| `cargo test` | Do the tests pass? |
| `cargo fmt` | Is the source formatted in the standard style? |
| `cargo clippy` | Are there common mistakes or suspicious patterns? |

Beginners often overuse `cargo run` while fixing compile errors. `cargo check` is usually the better first command because it is built for quick feedback.

## Manifest And Lockfile

The `Cargo.toml` file is the package manifest. TOML is a small configuration format with sections and key-value pairs. Cargo reads this file to learn the package name, version, edition, dependencies, and other settings.

A generated manifest looks like this:

```toml
[package]
name = "notes-cli"
version = "0.1.0"
edition = "2024"

[dependencies]
```

The `[package]` section describes the package itself. The `name` is the package name Cargo uses. The `version` starts at `0.1.0` for a new project. The `edition` tells the compiler which Rust edition rules to use for this package.

The `[dependencies]` section is where external crates go. A crate is a unit of Rust compilation and distribution. When people say "add a crate," they usually mean "add a dependency from crates.io or another source."

After the project builds, Cargo creates a `Cargo.lock` file. The lockfile records the exact dependency versions chosen for this project.

```text
# This file is automatically @generated by Cargo.
# It is not intended for manual editing.
version = 4

[[package]]
name = "notes-cli"
version = "0.1.0"
```

For an application, commit `Cargo.lock` so everyone builds and tests against the same resolved dependency versions. For a reusable library, the lockfile policy depends on the repository and publishing workflow, but Cargo will still create one locally during builds.

The important distinction is simple:

| File | Human role | Cargo role |
| --- | --- | --- |
| `Cargo.toml` | You edit it to describe the package and dependency requirements. | Cargo reads it as the manifest. |
| `Cargo.lock` | You usually review it, but do not hand-edit it. | Cargo writes exact resolved versions into it. |
| `target/` | You usually ignore it. | Cargo writes build output into it. |

If a dependency version changes, the manifest explains the requirement and the lockfile shows the exact chosen result.

## Formatting, Linting, And Testing

Rust projects normally use the standard formatter. Run it from the package directory:

```bash
$ cargo fmt
```

Most successful formatter runs print nothing. That silence is normal. It means `rustfmt` formatted the source files and found no problem worth reporting.

Clippy is Rust's common linter. It catches patterns that compile but are often mistakes, confusing, or needlessly awkward.

```bash
$ cargo clippy
    Checking notes-cli v0.1.0 (/home/you/notes-cli)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.18s
```

When Clippy finds something, it usually explains the pattern and suggests a fix. Treat Clippy suggestions as review prompts. Many are worth following; some are style choices that need context.

Tests run with `cargo test`. Add this small helper to `src/main.rs` above `main`:

```rust
fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

#[test]
fn counts_words() {
    assert_eq!(count_words("hello rust"), 2);
}
```

Now run:

```bash
$ cargo test
   Compiling notes-cli v0.1.0 (/home/you/notes-cli)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.31s
     Running unittests src/main.rs (target/debug/deps/notes_cli-9c4a6f...)

running 1 test
test counts_words ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

Cargo built a test binary, ran the test function, and reported the result. A Rust test is an ordinary function marked with `#[test]`. The `assert_eq!` macro fails the test if the two values differ.

## Dependencies And Docs

Cargo can add dependencies for you. For example, `anyhow` is a common crate for application error handling:

```bash
$ cargo add anyhow
    Updating crates.io index
      Adding anyhow v1.0.95 to dependencies
```

Cargo updates `Cargo.toml`:

```toml
[dependencies]
anyhow = "1.0.95"
```

It also updates `Cargo.lock` after resolving the exact version. The version in `Cargo.toml` is a requirement. The version in `Cargo.lock` is the exact version selected for this project at that moment.

Rust documentation is built from the code itself. Run:

```bash
$ cargo doc --open
 Documenting notes-cli v0.1.0 (/home/you/notes-cli)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.26s
     Opening /home/you/notes-cli/target/doc/notes_cli/index.html
```

The generated docs live under `target/doc`. Public crates published on crates.io are commonly documented on docs.rs, which uses Rust's documentation tooling to present crate APIs in a consistent shape.

This matters even before you publish a crate. Rust signatures carry a lot of information. Documentation generated from those signatures becomes a useful map of functions, structs, enums, traits, and modules.

## Putting It All Together

The workflow is smaller than it first looks:

```bash
$ cargo new notes-cli
$ cd notes-cli
$ cargo check
$ cargo test
$ cargo run
$ cargo fmt
$ cargo clippy
```

`cargo new` creates the package. `cargo check` gives fast compiler feedback. `cargo test` runs the test suite. `cargo run` builds and executes the binary. `cargo fmt` and `cargo clippy` keep the code readable and catch common issues.

The project files explain where Cargo gets its information:

- `Cargo.toml` describes the package and dependency requirements.
- `Cargo.lock` records exact dependency versions.
- `src/main.rs` is the default binary crate root.
- `target/` contains build output managed by Cargo.

Once this loop feels normal, Rust becomes less mysterious. You can make a change, ask Cargo for feedback, read the compiler output, and try again.

## What's Next

The generated `main.rs` file is small, but it already contains Rust syntax that deserves careful reading: `fn`, `main`, braces, macro calls, semicolons, strings, bindings, return types, and expressions. The next article slows down and reads small Rust programs the way this article read terminal output.

---

**References**

- [The Rust Programming Language: Installation](https://doc.rust-lang.org/book/ch01-01-installation.html) - Official setup guide for installing Rust with `rustup`.
- [The Rust Programming Language: Hello, Cargo!](https://doc.rust-lang.org/book/ch01-03-hello-cargo.html) - Official beginner guide to creating and running a Cargo project.
- [The Cargo Book](https://doc.rust-lang.org/cargo/) - Official Cargo documentation for packages, commands, manifests, dependencies, and publishing.
- [The Cargo Book: cargo-new](https://doc.rust-lang.org/cargo/commands/cargo-new.html) - Official reference for `cargo new`.
- [rustup Book](https://rust-lang.github.io/rustup/) - Official documentation for managing Rust toolchains and targets.
- [Clippy Documentation](https://doc.rust-lang.org/clippy/) - Official documentation for Rust's linter.
