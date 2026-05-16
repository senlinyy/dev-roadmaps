---
title: "Project Structure"
description: "Organize a small Rust project with packages, crates, modules, visibility, lib.rs, main.rs, and integration tests."
overview: "Once Rust code grows beyond one file, project structure becomes part of the design. This article shows how Cargo's package shape, crate roots, modules, visibility, and tests fit together."
tags: ["modules", "crates", "packages", "tests"]
order: 3
id: article-rust-rust-foundations-project-structure
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Packages And Crates](#packages-and-crates)
3. [main.rs And lib.rs](#mainrs-and-librs)
4. [Modules](#modules)
5. [Visibility](#visibility)
6. [Integration Tests](#integration-tests)
7. [A Small Layout](#a-small-layout)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

The notes program has grown. `main.rs` now parses a command, stores notes, searches text, formats output, and prints results. It still compiles, but every change requires scrolling through one file.

That creates a different kind of bug. The program is not failing because Rust is strict. It is failing because the code has no map:

- The command-line entry point is mixed with reusable logic.
- Helper functions are visible only because they sit nearby.
- Tests are awkward because the behavior lives inside the binary file.
- Future modules have no obvious place to go.

Rust project structure solves this by separating package, crate, module, and visibility decisions. Those words sound abstract, but the day-to-day habit is practical: keep `main.rs` thin, put reusable behavior in `lib.rs` and modules, and expose only the pieces other code needs.

## Packages And Crates

Cargo works with packages. A package has a `Cargo.toml` manifest and contains one or more crates.

A crate is the unit the compiler works on. A crate can be a binary crate, which builds an executable, or a library crate, which exposes reusable code.

For a small app, Cargo's default layout starts here:

```text
rust-notes/
  Cargo.toml
  src/
    main.rs
```

That package contains one binary crate. `src/main.rs` is the crate root. The crate root is the file where the compiler starts building that crate's module tree.

If you add `src/lib.rs`, the same package also contains a library crate:

```text
rust-notes/
  Cargo.toml
  src/
    lib.rs
    main.rs
```

This is a common shape for command-line apps. The binary crate handles startup, input, and output. The library crate holds behavior that can be tested and reused.

:::expand[One package can have several crate roots]{kind="design"}
The package is the project Cargo manages. The crate root is where the compiler starts building one crate inside that package.

That means one package can contain several starting points:

```text
rust-notes/
  Cargo.toml
  src/
    lib.rs
    main.rs
    bin/
      import_notes.rs
      export_notes.rs
```

`src/lib.rs` is the library crate root. `src/main.rs` is the default binary crate root. Files under `src/bin/` are extra binary crate roots.

That layout gives you several executables that can share one library:

```bash
cargo run
cargo run --bin import_notes
cargo run --bin export_notes
```

The default `cargo run` uses `src/main.rs`. The `--bin` flag selects one of the extra binaries under `src/bin/`.

Each binary should stay thin. For example, `src/bin/import_notes.rs` might parse command-line arguments and then call `rust_notes::import_from_file(path)`. The real import behavior belongs in `src/lib.rs` or a module under it, where it can be tested and reused.

This is the design reason behind the layout: a package is allowed to contain multiple products, but the shared behavior should not be copied between them. The import tool, export tool, and main app can all call the same parsing, model, and storage code from the library crate.
:::

## main.rs And lib.rs

`main.rs` should answer one question: how does the program start?

For the notes app, keep it thin:

```rust
use rust_notes::count_words;

fn main() {
    let text = "Cargo creates Rust projects";
    let count = count_words(text);

    println!("{count} words");
}
```

The reusable logic goes in `lib.rs`:

```rust
pub fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}
```

The line `use rust_notes::count_words;` may look surprising. The binary crate can use the library crate from the same package by the package name, with hyphens converted to underscores. If the package is named `rust-notes`, the crate path is `rust_notes`.

This split gives you a cleaner testing path. Functions in `lib.rs` are library items. Integration tests can import them like external users would.

## Modules

As the library grows, split related code into modules.

Start with a parser module:

```text
rust-notes/
  src/
    lib.rs
    main.rs
    parser.rs
```

Declare the module in `lib.rs`:

```rust
pub mod parser;

pub fn count_words(text: &str) -> usize {
    parser::words(text).len()
}
```

Then define the module in `parser.rs`:

```rust
pub fn words(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}
```

The module declaration `pub mod parser;` tells Rust to include `src/parser.rs` as the `parser` module. The `pub` makes the module visible to users of the library crate.

Without `pub`, the module is private to the crate. That is often what you want for internal helpers.

## Visibility

Rust is private by default. This is true for modules, functions, structs, fields, and many other items.

Private by default is useful because it makes the public API intentional. If other code cannot depend on an internal helper, you can change that helper later without breaking callers.

Here is a small example:

```rust
pub struct Note {
    pub title: String,
    body: String,
}

impl Note {
    pub fn new(title: String, body: String) -> Note {
        Note { title, body }
    }

    pub fn word_count(&self) -> usize {
        self.body.split_whitespace().count()
    }
}
```

Callers can read `title`, but they cannot directly read or change `body`. They must use behavior the type exposes, such as `word_count`.

This is not about hiding code for its own sake. It is about making promises smaller. Public items are promises to other code. Private items are implementation details you can reshape.

:::expand[Keep modules private, re-export the API you mean]{kind="pattern"}
A common library pattern is to keep the file layout private and re-export the small API callers should use.

The project might look like this:

```text
rust-notes/
  src/
    lib.rs
    parser.rs
    model.rs
```

In `lib.rs`:

```rust
mod parser;
mod model;

pub use parser::count_words;
pub use model::Note;
```

In `parser.rs`:

```rust
pub fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}
```

Now callers write:

```rust
let count = rust_notes::count_words("one two three");
```

They do not depend on the fact that the function currently lives in `parser.rs`.

Later, the internal layout might become:

```text
src/
  lib.rs
  text/
    mod.rs
    parser.rs
```

If `lib.rs` still re-exports `count_words`, outside callers do not change. That is the point of this pattern. Modules organize your implementation. Re-exports define the public path you want other code to rely on.

The trap is making every module `pub mod` too early. That exposes the file layout as part of your API. Start private, then re-export the names that form the real interface.
:::

## Integration Tests

Rust supports tests inside modules, but integration tests live in `tests/` and use the library from the outside.

```text
rust-notes/
  tests/
    word_count_test.rs
```

The test imports the library crate:

```rust
use rust_notes::count_words;

#[test]
fn counts_words() {
    assert_eq!(count_words("one two three"), 3);
}
```

Run it with:

```bash
cargo test
```

Integration tests are useful because they behave like a real caller. They can only use public API. If a test cannot reach a function, that is a design question: should the behavior be public, or should it be tested through a public function that uses it?

## A Small Layout

A useful beginner layout for a command-line Rust project looks like this:

```text
rust-notes/
  Cargo.toml
  src/
    main.rs
    lib.rs
    model.rs
    parser.rs
  tests/
    parser_test.rs
```

One possible responsibility split:

| File | Job |
| --- | --- |
| `main.rs` | Read inputs, call library code, print output |
| `lib.rs` | Re-export the library's useful public API |
| `model.rs` | Define structs and enums such as `Note` and `NoteStatus` |
| `parser.rs` | Parse text into note data or words |
| `tests/parser_test.rs` | Test behavior from the outside |

This is not the only valid structure. It is a starting map. The better rule is: split code when the split gives a reader a clearer place to look.

:::expand[Split by responsibility, not by noun count]{kind="pitfall"}
A new Rust file should earn its place by giving the reader a better map. It should not exist just because you introduced one more struct.

This looks organized at first:

```text
src/
  note.rs
  note_status.rs
  notebook.rs
  word.rs
  word_count.rs
```

But if those files are tiny and always change together, the split creates navigation tax. A reader has to open five files to understand one small model.

For a beginner notes app, this may be clearer:

```text
src/
  model.rs
  parser.rs
  storage.rs
```

`model.rs` can hold related types such as `Note`, `NoteStatus`, and `Notebook`. `parser.rs` earns its file because parsing has its own edge cases and tests. `storage.rs` earns its file once paths, serialization, and I/O errors become their own concern.

Good reasons to split include:

| Split pressure | What it means |
| --- | --- |
| Different tests | The behavior has its own edge cases |
| Different dependencies | One area needs `serde`, another does not |
| Different change rate | Storage changes often, model types stay stable |
| Different audience | Some items are public API, others are internal helpers |

Structure should reduce thinking load, not perform tidiness. If a split makes the reader ask "where did the code go?", it may be too early.
:::

## Putting It All Together

The opening problem was a crowded `main.rs`. Rust gives you several layers for organizing code:

- A package is the Cargo-managed project described by `Cargo.toml`.
- A crate is what the compiler builds as a library or executable.
- `main.rs` is the normal root for a binary crate.
- `lib.rs` is the normal root for a library crate.
- Modules split code into named areas.
- `pub` controls which parts become part of the public API.
- Integration tests use the library like an outside caller.

The habit is simple: keep startup code near `main`, keep reusable behavior in the library, group related code into modules, and make public only what other code should rely on.

## What's Next

You now have the first Rust foundation: why Rust exists, how to run it, how to read it, how to model simple data, and how to organize a small project. The next module starts the real Rust gate: ownership, borrowing, references, strings, slices, and lifetimes.

---

**References**

- [Packages, Crates, and Modules](https://doc.rust-lang.org/book/ch07-00-managing-growing-projects-with-packages-crates-and-modules.html). Supports the role of packages, crates, modules, paths, scope, and privacy.
- [Packages and Crates](https://doc.rust-lang.org/book/ch07-01-packages-and-crates.html). Supports package structure, binary crates, library crates, `src/main.rs`, and `src/lib.rs`.
- [First Steps with Cargo](https://doc.rust-lang.org/stable/cargo/getting-started/first-steps.html). Supports Cargo's generated project layout and manifest behavior.
- [Hello, Cargo!](https://doc.rust-lang.org/stable/book/ch01-03-hello-cargo.html). Supports Cargo's project workflow and generated package files.
