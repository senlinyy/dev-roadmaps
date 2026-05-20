---
title: "Project Structure"
description: "Understand packages, crates, modules, paths, visibility, main.rs, lib.rs, and tests in a small Rust project."
overview: "Rust projects use Cargo and a module system to organize code. This article explains the file layout and naming rules a beginner needs before reading larger repositories."
tags: ["modules", "crates", "packages", "tests"]
order: 5
id: article-rust-rust-foundations-project-structure
---

## Table of Contents

1. [What Is a Rust Project?](#what-is-a-rust-project)
2. [The Map: Package, Crate, Module, Path](#the-map-package-crate-module-path)
3. [main.rs And lib.rs](#mainrs-and-librs)
4. [Modules](#modules)
5. [Paths and use](#paths-and-use)
6. [Visibility](#visibility)
7. [Integration Tests](#integration-tests)
8. [Common Layouts](#common-layouts)
9. [Putting It All Together](#putting-it-all-together)
10. [Toward Computer Science for Rust](#toward-computer-science-for-rust)

## What Is a Rust Project?

If you are used to small scripts, one file can feel like the whole program. Rust can start that way too. A beginner project created by Cargo has one manifest and one source file:

```bash
$ cargo new notes-cli
    Creating binary (application) `notes-cli` package
$ tree -L 2 notes-cli
notes-cli
├── Cargo.toml
└── src
    └── main.rs
```

That is enough for a tiny command-line program. The manifest describes the package, and `src/main.rs` contains the executable code.

The shape changes as soon as code needs to be reused. A notes program may need a command-line entry point, a note model, parsing helpers, and tests. If everything stays in `main.rs`, the file becomes hard to scan and harder to test. Rust's project structure gives you names for the pieces before the project gets large.

Here is a slightly larger layout:

```text
notes-cli
├── Cargo.toml
├── Cargo.lock
├── src
│   ├── lib.rs
│   ├── main.rs
│   └── note.rs
└── tests
    └── note_summary.rs
```

This project has one package, a binary crate, a library crate, one module file, and one integration test. Those words are easy to mix up, so the next section builds the map slowly.

## The Map: Package, Crate, Module, Path

Rust uses four names that sound similar at first: package, crate, module, and path. They describe different layers of organization.

| Word | Plain meaning | Example |
| --- | --- | --- |
| Package | A Cargo project described by `Cargo.toml` | `notes-cli` |
| Crate | A compilation unit that produces a library or executable | `src/main.rs` or `src/lib.rs` |
| Module | A namespace inside a crate | `note` |
| Path | A name that points to an item | `crate::note::Note` |

A package is Cargo's unit. It has a manifest, dependencies, build settings, and usually source files under `src/`.

A crate is Rust's compilation unit. A binary crate builds an executable. A library crate builds reusable code that other code can call. One package can contain a library crate and one or more binary crates.

A module organizes items inside a crate. Items are things like functions, structs, enums, constants, traits, and nested modules. Modules let you group related code and control which names are visible from outside.

A path is how Rust names an item. The path `crate::note::Note` means "start at this crate root, enter the `note` module, then find the `Note` item."

The map is easier to see as a tree:

```text
Package: notes-cli
├── Cargo.toml
├── Crate: library (src/lib.rs)
│   └── Module: note (src/note.rs)
│       └── Item: Note
└── Crate: binary (src/main.rs)
    └── uses the library crate
```

When a Rust repository feels confusing, start by asking which layer you are looking at. `Cargo.toml` is package-level. `main.rs` and `lib.rs` are crate roots. `mod note;` declares a module. `crate::note::Note` is a path to an item.

## main.rs And lib.rs

Cargo gives special meaning to two files under `src/`.

`src/main.rs` is the default root of a binary crate. It builds an executable. If the package is a command-line tool or server, `main.rs` is where the process starts.

`src/lib.rs` is the default root of a library crate. It builds reusable code that can be used by the package's binary, integration tests, examples, or other packages.

A common beginner refactor is to move reusable logic out of `main.rs` and into `lib.rs` plus module files.

Start with a crowded `main.rs`:

```rust
struct Note {
    title: String,
    body: String,
}

impl Note {
    fn new(title: &str, body: &str) -> Self {
        Self {
            title: title.to_string(),
            body: body.to_string(),
        }
    }

    fn summary(&self) -> String {
        format!("{}: {}", self.title, self.body)
    }
}

fn main() {
    let note = Note::new("Deploy notes", "Remember the release checklist");
    println!("{}", note.summary());
}
```

This works, but the model and the entry point are tied together. Split the reusable model into the library side.

`src/lib.rs` becomes:

```rust
pub mod note;

pub use note::Note;
```

`src/main.rs` becomes:

```rust
use notes_cli::Note;

fn main() {
    let note = Note::new("Deploy notes", "Remember the release checklist");
    println!("{}", note.summary());
}
```

The line `use notes_cli::Note;` imports the public `Note` type from the library crate. Cargo turns the package name `notes-cli` into the Rust crate name `notes_cli` because Rust crate names use underscores in code.

This split gives tests and other code a clean public API to call. It also keeps `main.rs` focused on starting the program, parsing input, and connecting pieces together.

## Modules

A module is a namespace. It groups items and controls visibility.

The line in `src/lib.rs` declares a module:

```rust
pub mod note;
```

That declaration tells Rust to load module code from a file. For a module named `note`, Rust looks for one of these standard shapes:

| Declaration | File Rust reads |
| --- | --- |
| `mod note;` | `src/note.rs` |
| `mod note;` | `src/note/mod.rs` |

The flat file form is common for small modules:

```text
src
├── lib.rs
├── main.rs
└── note.rs
```

The directory form is useful when a module grows its own submodules:

```text
src
├── lib.rs
├── main.rs
└── note
    ├── mod.rs
    ├── parser.rs
    └── status.rs
```

Inside `src/note.rs`, define the type:

```rust
pub struct Note {
    title: String,
    body: String,
}

impl Note {
    pub fn new(title: &str, body: &str) -> Self {
        Self {
            title: title.to_string(),
            body: body.to_string(),
        }
    }

    pub fn summary(&self) -> String {
        format!("{}: {}", self.title, self.body)
    }
}
```

The struct and methods are marked `pub` so code outside the module can use them. The fields are private because callers should build notes through `Note::new` and read summaries through `summary`. Visibility is covered more below.

The useful habit is to keep modules named after the job they own. A `note` module should own the note model and closely related behavior. A `parser` module should own parsing. A `storage` module should own storage concerns. Names should help a reader guess where code lives.

## Paths and use

A path names an item. Rust paths use `::` between segments.

Inside the library crate, the full path to the note type is:

```rust
crate::note::Note
```

`crate` means the current crate root. `note` is the module declared in `lib.rs`. `Note` is the struct inside that module.

You can write the full path each time:

```rust
fn print_note(note: crate::note::Note) {
    println!("{}", note.summary());
}
```

That becomes noisy, so Rust has `use` imports:

```rust
use crate::note::Note;

fn print_note(note: Note) {
    println!("{}", note.summary());
}
```

The `use` line brings the name `Note` into the current scope. It does not copy code or load a package at runtime. It only gives the current module a shorter name for an item.

From the binary crate, the path starts with the library crate name:

```rust
use notes_cli::Note;
```

That works because `src/lib.rs` re-exported the type:

```rust
pub use note::Note;
```

A re-export makes an item available through a shorter public path. Without that line, callers would use:

```rust
use notes_cli::note::Note;
```

Both paths can be valid. The shorter public path is often nicer when `Note` is an important type in the library's API.

## Visibility

Rust items are private by default. That means code outside the current module cannot use them unless you mark them public.

This struct is public, but its fields are private:

```rust
pub struct Note {
    title: String,
    body: String,
}
```

External code can name `Note`, but it cannot build one by writing the fields directly:

```rust
let note = Note {
    title: String::from("Deploy notes"),
    body: String::from("Remember the release checklist"),
};
```

That fails outside the module because the fields are private. Callers must use the public constructor:

```rust
let note = Note::new("Deploy notes", "Remember the release checklist");
```

This is a deliberate API boundary. The module controls how a valid note is built. Later, if the struct gains a `status` field or needs validation, callers can keep using `Note::new`.

Public methods are marked on the method itself:

```rust
impl Note {
    pub fn new(title: &str, body: &str) -> Self {
        Self {
            title: title.to_string(),
            body: body.to_string(),
        }
    }

    pub fn summary(&self) -> String {
        format!("{}: {}", self.title, self.body)
    }
}
```

Visibility is one of Rust's main project-structure tools. It lets a module keep helper details private while exposing the smaller surface callers should use.

The common levels are:

| Visibility | Meaning |
| --- | --- |
| private by default | Usable only from the current module and its child modules. |
| `pub` | Public to callers that can reach the module path. |
| `pub(crate)` | Public inside the current crate, private to outside crates. |
| `pub(super)` | Public to the parent module. |

Start simple. Use private by default, then make a type or method public when another module genuinely needs it.

## Integration Tests

Rust has unit tests and integration tests. Unit tests often live next to the code they test. Integration tests live in the top-level `tests/` directory and compile as separate crates that use your library from the outside.

That outside view is useful. It tests the public API the way another user of the crate would use it.

Create this file:

```text
tests/note_summary.rs
```

Then write:

```rust
use notes_cli::Note;

#[test]
fn builds_summary() {
    let note = Note::new("Deploy notes", "Remember the release checklist");

    assert_eq!(
        note.summary(),
        "Deploy notes: Remember the release checklist"
    );
}
```

Run the tests:

```bash
$ cargo test
   Compiling notes-cli v0.1.0 (/home/you/notes-cli)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.37s
     Running tests/note_summary.rs (target/debug/deps/note_summary-...)

running 1 test
test builds_summary ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

The test imports `Note` through `use notes_cli::Note;`, just like the binary did. If `Note` or its methods are not public, this integration test will not compile. That is a feature, because it tells you whether the library API is actually usable from the outside.

Integration tests are a good reason to move reusable logic into `lib.rs`. A binary-only project can still be tested, but the cleanest public API usually lives in the library crate.

## Common Layouts

Rust projects tend to use a few recognizable layouts.

The smallest binary project:

```text
notes-cli
├── Cargo.toml
└── src
    └── main.rs
```

This is fine for a tiny program or learning exercise.

A binary plus library:

```text
notes-cli
├── Cargo.toml
├── src
│   ├── lib.rs
│   ├── main.rs
│   └── note.rs
└── tests
    └── note_summary.rs
```

This is common when the command-line entry point uses reusable logic that tests should call directly.

A package with multiple binaries:

```text
notes-cli
├── Cargo.toml
└── src
    ├── bin
    │   ├── export.rs
    │   └── import.rs
    ├── lib.rs
    └── note.rs
```

Each file under `src/bin/` becomes a separate binary target. This is useful when a package contains related commands that share the same library code.

A module that grew into a directory:

```text
src
├── lib.rs
└── note
    ├── mod.rs
    ├── parser.rs
    └── status.rs
```

This layout keeps a larger module split into focused files. The `note/mod.rs` file is the module root, and it can declare submodules such as `parser` and `status`.

Here is the quick reference:

| File or directory | Purpose |
| --- | --- |
| `Cargo.toml` | Package manifest and dependency requirements. |
| `Cargo.lock` | Exact resolved dependency versions. |
| `src/main.rs` | Default binary crate root. |
| `src/lib.rs` | Default library crate root. |
| `src/name.rs` | Flat module file. |
| `src/name/mod.rs` | Directory-style module root. |
| `src/bin/*.rs` | Additional binary targets. |
| `tests/*.rs` | Integration tests. |
| `target/` | Cargo-managed build output. |

When exploring a repository, start at `Cargo.toml`, then check whether `src/main.rs`, `src/lib.rs`, or both exist. From there, follow `mod` declarations and `use` paths.

## Putting It All Together

The project started as one file:

```text
src/main.rs
```

That was enough to print text. As the notes program gained a model and tests, the structure became:

```text
notes-cli
├── Cargo.toml
├── Cargo.lock
├── src
│   ├── lib.rs
│   ├── main.rs
│   └── note.rs
└── tests
    └── note_summary.rs
```

Each piece has a job:

- The package is the Cargo project described by `Cargo.toml`.
- The binary crate in `main.rs` starts the executable.
- The library crate in `lib.rs` exposes reusable code.
- The `note` module groups the note model and behavior.
- Paths such as `notes_cli::Note` name items across crate boundaries.
- Visibility keeps helper details private and exposes the intended API.
- Integration tests use the public API from the outside.

Project structure is a reading tool as much as an organization tool. Once you know the map, an unfamiliar Rust repository becomes less like a pile of files and more like a set of named boundaries.

## Toward Computer Science for Rust

Rust Foundations gave you the first surface: why Rust exists, how Cargo runs the workflow, how small programs read, how types model states, and where files live in a project.

The next module goes underneath that surface. It explains what a running program is doing, where values live in memory, why stack and heap matter, how types give meaning to bits, and how data structures and threads change the shape of a Rust program.

---

**References**

- [The Cargo Book: Package Layout](https://doc.rust-lang.org/cargo/guide/project-layout.html) - Official Cargo guide to standard project layout.
- [The Rust Programming Language: Packages and Crates](https://doc.rust-lang.org/book/ch07-01-packages-and-crates.html) - Official explanation of packages, crates, binary crates, and library crates.
- [The Rust Programming Language: Defining Modules](https://doc.rust-lang.org/book/ch07-02-defining-modules-to-control-scope-and-privacy.html) - Official guide to module declarations and file structure.
- [The Rust Programming Language: Paths](https://doc.rust-lang.org/book/ch07-03-paths-for-referring-to-an-item-in-the-module-tree.html) - Official explanation of paths and the `use` keyword.
- [The Rust Programming Language: Separating Modules Into Different Files](https://doc.rust-lang.org/book/ch07-05-separating-modules-into-different-files.html) - Official guide to module files and directory layout.
- [The Rust Programming Language: Automated Tests](https://doc.rust-lang.org/book/ch11-00-testing.html) - Official guide to Rust tests, including integration tests.
