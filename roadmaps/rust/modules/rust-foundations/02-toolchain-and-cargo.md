---
title: "Toolchain And Cargo"
description: "Install or verify Rust, create a project with Cargo, and use the small command loop that Rust developers run every day."
overview: "Rust's language and tooling are learned together. This article explains rustup, rustc, Cargo, rustfmt, Clippy, Cargo.toml, Cargo.lock, and the daily commands that keep a small Rust project moving."
tags: ["rustup", "cargo", "rustfmt", "clippy"]
order: 2
id: article-rust-rust-foundations-toolchain-and-cargo
aliases: ["rust-foundations/getting-started/02-toolchain-and-cargo.md"]
---

## Table of Contents

1. [The Problem](#the-problem)
2. [rustup](#rustup)
3. [Cargo](#cargo)
4. [First Project](#first-project)
5. [The Daily Loop](#the-daily-loop)
6. [Manifest And Lockfile](#manifest-and-lockfile)
7. [Tooling Gotchas](#tooling-gotchas)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

Rust has a reputation for being hard, so beginners often try to simplify the setup. They install a compiler from a package manager, copy a single-file example, and run `rustc main.rs` directly. That can work for a tiny experiment, but it skips the workflow real Rust projects expect.

Then the first confusing questions arrive:

- Where do dependencies go?
- Why does every example mention Cargo?
- What is the difference between `cargo check`, `cargo build`, and `cargo run`?
- Why did Clippy or rustfmt not exist on this machine?

The fix is to learn the Rust toolchain as one system. You use `rustup` to manage Rust installations and components. You use Cargo to create, build, test, format, lint, document, and package projects. You use `rustc` directly much less often than you might expect.

## rustup

`rustup` is the toolchain manager. A toolchain is the set of tools for a Rust release channel and target platform: the compiler, standard library, Cargo, docs, and optional components.

Most learners should start on stable Rust. Stable is the normal release channel for application and library work. Beta and nightly exist, but they are not where a beginner should start unless a specific project requires them.

After installing Rust through the official installer, verify the basic tools:

```bash
rustup update
rustc --version
cargo --version
```

`rustup update` keeps installed toolchains current. `rustc --version` proves the compiler is available. `cargo --version` proves the project tool is available.

The default `rustup` profile includes useful development components such as local docs, rustfmt, and Clippy. If you installed a minimal profile, add the components explicitly:

```bash
rustup component add rustfmt clippy
```

That command matters because Rust formatting and linting are not a separate culture layered on top later. They are part of the normal feedback loop.

:::expand[Pin a toolchain when the project needs one]{kind="pattern"}
Most beginner projects can use whatever stable Rust is current on the machine. Some real projects need a more exact setup because contributors, CI, docs, and examples should all agree on the same channel and components.

For that, a repository can include `rust-toolchain.toml` at the project root:

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
targets = ["wasm32-unknown-unknown"]
```

When you run Rust commands inside that project, rustup can use this file as a local override. A teammate who enters the repo and runs `cargo test` does not need to remember a separate setup note for Clippy or the WebAssembly target.

The file can also pin a specific version:

```toml
[toolchain]
channel = "1.84.0"
components = ["rustfmt", "clippy"]
```

That is useful when a production project needs controlled upgrades. It is also useful for a workshop or course where every learner should see the same compiler behavior.

The beginner rule is simple: do not pin just because the file exists. Start with stable. Add `rust-toolchain.toml` when the project has a real coordination problem: CI needs repeatability, a target must be installed, nightly is required for a specific feature, or a team wants Rust upgrades to happen as intentional pull requests.
:::

## Cargo

Cargo is Rust's build system and package manager. It creates projects, reads project metadata, downloads dependencies, builds your code, runs tests, generates docs, and talks to the Rust package registry.

For most Rust work, Cargo is the front door. You do not usually run `rustc` directly because Cargo knows the project shape. It knows where `Cargo.toml` is, which files are crate roots, which dependencies are needed, and which targets should be built.

Think of Cargo as doing three jobs at once:

| Cargo job | What it handles |
| --- | --- |
| Project shape | Creates `Cargo.toml`, `src/main.rs`, `src/lib.rs`, and conventional target paths |
| Build workflow | Runs check, build, run, test, doc, fmt, and clippy commands |
| Dependency workflow | Records dependencies, resolves versions, and builds dependency crates |

That is why learning Cargo early is not a distraction from learning Rust. Cargo is how Rust code becomes a project.

:::expand[Cargo is the project interface, rustc is the engine]{kind="design"}
`rustc` is the compiler. Cargo is the project interface that knows when and how to call the compiler.

That distinction matters once the project is more than one file:

```text
rust-notes/
  Cargo.toml
  src/
    main.rs
    lib.rs
  tests/
    parser_test.rs
```

If you run `rustc src/main.rs`, you are asking the compiler to treat one file as the whole world. That skips the package manifest, dependency resolution, integration tests, feature flags, examples, docs, and the normal target layout.

When you run `cargo test`, Cargo does several jobs around `rustc`:

| Cargo knows | Why it matters |
| --- | --- |
| Which package this is | It finds `Cargo.toml` and package metadata |
| Which crates exist | It builds the library, binary, tests, and examples as needed |
| Which dependencies are required | It downloads and builds dependency crates first |
| Which features are enabled | It passes the right configuration to the compiler |
| Where artifacts go | It stores build output under `target/` |

You can still call `rustc` directly for a tiny one-file experiment. In normal Rust work, Cargo is the command you talk to because Cargo understands the project graph around the compiler.
:::

## First Project

Create a scratch project:

```bash
cargo new rust-notes
cd rust-notes
cargo run
```

Cargo creates a directory with a manifest and a source file:

```text
rust-notes/
  Cargo.toml
  src/
    main.rs
```

`Cargo.toml` is the manifest. It stores the package name, version, edition, and dependencies. `src/main.rs` is the crate root for the binary program Cargo created.

Open `src/main.rs`. The first program is deliberately tiny:

```rust
fn main() {
    println!("Hello, world!");
}
```

This file proves three things. `main` is the entry point for a binary program. `println!` prints text and uses a macro call, which is why it has `!`. Cargo can compile and run the package without you naming the source file by hand.

## The Daily Loop

The most useful early Cargo commands are not all the same speed or purpose.

```bash
cargo check
cargo run
cargo test
cargo fmt
cargo clippy
cargo doc --open
```

`cargo check` asks, "does this compile?" It is usually faster than building an executable because it can skip some final code generation. Use it while editing.

`cargo run` builds and runs the binary. Use it when you want to see behavior.

`cargo test` builds and runs tests. You will use it more once functions move into a library file.

`cargo fmt` formats code with rustfmt. Formatting is not a personality test in Rust. Let the tool do it.

`cargo clippy` runs extra lints. Clippy catches common mistakes and suggests more idiomatic Rust. Treat suggestions as review comments, not as orders from the sky. Read them, understand them, and then decide.

`cargo doc --open` generates local documentation for your project and dependencies, then opens it. This is surprisingly useful once dependencies enter the project because it shows the docs for the exact versions you are using.

For a small project, the loop often feels like this:

```text
edit -> cargo check -> cargo fmt -> cargo clippy -> cargo test -> cargo run
```

You do not need to run every command after every keystroke. The habit is to use the cheapest command that answers your current question.

## Manifest And Lockfile

`Cargo.toml` describes the package. A new binary project has a package section and a dependencies section:

```toml
[package]
name = "rust-notes"
version = "0.1.0"
edition = "2024"

[dependencies]
```

The package section is metadata Cargo needs to compile the package. The dependencies section starts empty. Later, if you add a crate such as a command-line parser or JSON library, Cargo records that dependency here.

After you build, Cargo may create `Cargo.lock`. The lockfile records exact dependency versions after resolution. For applications and command-line tools, commit it. It helps builds stay reproducible. For libraries, the decision has more nuance, but beginners can remember the application rule first.

The important distinction is simple: `Cargo.toml` says what your project asks for; `Cargo.lock` records what Cargo actually selected.

:::expand[Why applications usually commit Cargo.lock]{kind="pitfall"}
`Cargo.toml` usually describes acceptable dependency versions. `Cargo.lock` records the exact versions Cargo resolved at the time of a successful build.

For example, the manifest may say:

```toml
[dependencies]
serde = "1"
```

That line allows compatible `1.x` versions according to Cargo's resolver rules. After resolution, the lockfile records the exact selected package version:

```toml
[[package]]
name = "serde"
version = "1.0.217"
```

If this is an application or command-line tool, that exact graph is part of the build. Another developer, CI, or a deploy machine should not accidentally pick a different dependency set just because time passed and newer compatible versions were published.

The pitfall is subtle. Your source code did not change, but the dependency graph did. Now one person sees a failure and another cannot reproduce it. Committing `Cargo.lock` makes dependency changes visible. When you want to update, you run a command such as:

```bash
cargo update
```

That turns dependency movement into an intentional change that code review can see. Library crates have a more nuanced decision because downstream users resolve their own graph. For beginners, the useful rule is: applications and tools usually commit `Cargo.lock`.
:::

## Tooling Gotchas

Three gotchas save time early.

First, `cargo check` does not run your program. It only answers the compile question. If you changed behavior, use `cargo run` or `cargo test`.

Second, `rustfmt` and Clippy are tied to your installed toolchain components. If `cargo fmt` or `cargo clippy` is missing, install the component with `rustup component add`.

Third, Rust examples often assume you are inside the project directory. Cargo searches for the manifest from the current directory upward. If Cargo says it cannot find `Cargo.toml`, check where your shell is:

```bash
pwd
ls
```

That tiny habit prevents many fake Rust problems that are really just directory problems.

## Putting It All Together

The opening problem was tool confusion. Rust becomes much calmer when each tool has a job:

- `rustup` manages Rust versions and components.
- `rustc` is the compiler.
- Cargo is the project workflow.
- `Cargo.toml` is the project manifest.
- `Cargo.lock` records exact resolved dependency versions.
- `cargo check` answers the fast compile question.
- `cargo run`, `cargo test`, `cargo fmt`, `cargo clippy`, and `cargo doc --open` answer behavior, quality, and documentation questions.

You now have the project loop Rust developers expect. Keep the scratch project messy enough to learn in. It is a workbench, not a portfolio piece.

## What's Next

The next article reads ordinary Rust code. You will look at `fn main`, variable bindings, mutability, expressions, functions, control flow, strings, vectors, and the small syntax choices that make Rust code feel different from other languages.

---

**References**

- [Install Rust](https://rust-lang.org/tools/install). Supports the official rustup installation and update path.
- [The rustup book: Basic usage](https://rust-lang.github.io/rustup/basics.html). Supports `rustup update`, stable channel usage, and the rustup help system.
- [The rustup book: Profiles](https://rust-lang.github.io/rustup/concepts/profiles.html). Supports the default profile components, including rustfmt and Clippy.
- [The rustup book: Overrides](https://rust-lang.github.io/rustup/overrides.html). Supports project-level toolchain override behavior and `rust-toolchain.toml`.
- [Hello, Cargo!](https://doc.rust-lang.org/stable/book/ch01-03-hello-cargo.html). Supports Cargo's role as Rust's build system and package manager.
- [First Steps with Cargo](https://doc.rust-lang.org/stable/cargo/getting-started/first-steps.html). Supports `cargo new`, generated project structure, `Cargo.toml`, and `cargo run`.
- [cargo(1)](https://doc.rust-lang.org/cargo/commands/cargo.html). Supports the Cargo command families used in the article.
- [Cargo FAQ: Why have Cargo.lock in version control?](https://doc.rust-lang.org/cargo/faq.html#why-have-cargolock-in-version-control). Supports the role of `Cargo.lock` in deterministic builds and version-control decisions.
