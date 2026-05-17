---
title: "Docs, Formatting, And Clippy"
description: "Keep Rust projects readable with documentation comments, doctests, rustfmt, Clippy, and repeatable cargo checks."
overview: "A Rust project is easier to maintain when examples stay tested, formatting is automatic, and suspicious code is caught before review."
tags: ["docs", "rustdoc", "rustfmt", "clippy"]
order: 2
id: article-rust-idiomatic-rust-docs-formatting-and-clippy
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Documentation Comments](#documentation-comments)
3. [What rustdoc Builds](#what-rustdoc-builds)
4. [Doctests](#doctests)
5. [rustfmt](#rustfmt)
6. [What Lints Are](#what-lints-are)
7. [Clippy](#clippy)
8. [A Review Rhythm](#a-review-rhythm)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

The notes app is no longer a scratchpad. It has modules, errors, traits, collections, iterators, and tests. Now the maintenance problem appears.

A teammate opens the project and wonders:

- Which functions are public API, and how should they be used?
- Are examples in the docs still correct?
- Why did the pull request change formatting in files nobody touched?
- Did anyone notice the suspicious clone or needless allocation?

Rust has a strong culture of letting tools handle repeatable quality work. `rustdoc`, `rustfmt`, and Clippy do not replace design judgment, but they remove a lot of review noise.

## Documentation Comments

Rust documentation comments use `///` for items.

```rust
/// Returns the first Markdown heading without the leading marker.
pub fn title_from_markdown(input: &str) -> Option<&str> {
    input
        .lines()
        .find_map(|line| line.strip_prefix("# "))
}
```

The first sentence should tell the reader what the item does. More detail can explain important behavior, errors, or examples.

Good documentation is not a translation of the function name. It answers the caller's next question.

```rust
/// Finds the default notebook name in a config file.
///
/// Returns `None` when the config has no `default=` line.
pub fn default_notebook(config: &str) -> Option<&str> {
    config
        .lines()
        .find_map(|line| line.strip_prefix("default="))
        .map(str::trim)
}
```

Use docs most carefully on public functions, public structs, public enums, and public traits. Private helpers often need clearer names more than comments.

## What rustdoc Builds

`rustdoc` is Rust's documentation tool. It reads public items, documentation comments, examples, and type signatures, then builds browsable API documentation.

That matters because Rust docs are not only prose. They show the function signature beside the explanation, link types to their definitions, and can run examples as tests. For a library, docs are often the first interface another developer uses.

You can build local docs with:

```bash
cargo doc --no-deps --open
```

`--no-deps` keeps the focus on your crate instead of building every dependency's docs. Remove it when you want local docs for the full dependency graph.

## Doctests

Rust can run examples in documentation as tests.

A doctest is not only rendered documentation. `rustdoc` extracts the Rust code block, compiles it like an outside user, and runs the assertions.

````rust
/// Finds the default notebook name in a config file.
///
/// # Examples
///
/// ```
/// let config = "default=work\n";
/// assert_eq!(my_notes::default_notebook(config), Some("work"));
/// ```
pub fn default_notebook(config: &str) -> Option<&str> {
    config
        .lines()
        .find_map(|line| line.strip_prefix("default="))
        .map(str::trim)
}
````

When you run `cargo test`, Cargo also runs documentation tests for library examples. That is a powerful maintenance feature. The docs do not merely look plausible. The examples compile and run.

Doctests work best for small public examples. If an example needs a lot of setup, hide setup lines with `#` or move the complex scenario into a normal test.

:::expand[Hidden doctest setup with #]{kind="pattern"}
Sometimes a good public example needs a tiny bit of setup that would distract readers. In Rust doctests, a line that starts with `#` is compiled but hidden from the rendered example.

````rust
/// Returns the first Markdown heading.
///
/// ```
/// # use my_notes::title_from_markdown;
/// let input = "# Rust\nbody";
/// assert_eq!(title_from_markdown(input), Some("Rust"));
/// ```
pub fn title_from_markdown(input: &str) -> Option<&str> {
    input.lines().find_map(|line| line.strip_prefix("# "))
}
````

Readers see the useful example. The test still has the import it needs.

Use hidden lines sparingly. They are best for imports, tiny setup values, or making a public API example compile. If half the example is hidden, the doctest is probably doing too much and belongs in a normal test.
:::

:::expand[Docs are executable promises]{kind="design"}
Documentation examples often rot in other ecosystems because they are separate from the test workflow. Rust's doctests reduce that drift.

This example is not just text:

````rust
/// ```
/// let config = "default=work\n";
/// assert_eq!(my_notes::default_notebook(config), Some("work"));
/// ```
````

`rustdoc` extracts the code block and runs it as a test. If the function changes name, changes return type, or stops returning `"work"`, the documentation test can fail.

That changes how you should write examples. A doctest should be small, real, and focused on the public promise.

| Good doctest | Weak doctest |
| --- | --- |
| Shows one public behavior | Rebuilds a whole app scenario |
| Uses assertions | Only prints output nobody checks |
| Compiles without hidden magic | Depends on local files or network |
| Explains caller-facing behavior | Repeats implementation details |

Use normal tests for heavy setup. Use doctests to keep the public examples honest.
:::

## rustfmt

`rustfmt` formats Rust code automatically. Most developers run it through Cargo:

```bash
cargo fmt
```

The point is not that one formatting style is sacred. The point is that formatting should not be a debate in every review.

Before committing or opening a pull request, use the check form:

```bash
cargo fmt --all --check
```

If the check fails, run `cargo fmt` and review the actual code changes. Formatting should be boring and automatic. That gives reviewers more attention for ownership, errors, tests, and API design.

## What Lints Are

A lint is an automated warning about suspicious, confusing, or non-idiomatic code. If you know ESLint, Pylint, or Ruff, Clippy plays a similar role for Rust, with extra Rust-specific knowledge about ownership, allocation, iterators, and common mistakes.

Lints are not the type checker. The compiler decides whether the program is valid Rust. Lints ask whether the valid code is likely to be clearer, safer, or more idiomatic in another shape.

## Clippy

Clippy is Rust's linter collection. It catches common mistakes and suggests more idiomatic code.

Run it with:

```bash
cargo clippy
```

For stricter local or CI checks, many projects use:

```bash
cargo clippy --all-targets --all-features -- -D warnings
```

That command treats warnings as errors. It is useful for mature projects, but it can feel strict while learning. Start by reading Clippy suggestions. Apply the ones that make the code clearer. When a lint fights the domain, understand it before suppressing it.

Clippy is especially good at catching suspicious patterns: needless clones, awkward iterator code, avoidable allocations, and common logic mistakes.

:::expand[Use Clippy as a reviewer, not a boss]{kind="pitfall"}
Clippy is useful because it notices patterns humans miss. It is not a substitute for design judgment.

Suppose Clippy suggests replacing a manual loop with an iterator chain. That may be a good improvement:

```rust
let titles: Vec<&str> = notes
    .iter()
    .map(|note| note.title.as_str())
    .collect();
```

But if the loop has multiple side effects, early exits, and logging, forcing it into one chain may make the code harder to read.

Use this review habit:

| Clippy says | Ask |
| --- | --- |
| Remove a needless clone | Was the clone truly unnecessary? |
| Prefer an iterator method | Does the chain read better than the loop? |
| Simplify a boolean expression | Does the simpler form preserve intent? |
| Enable a strict lint group | Is the team ready to maintain that standard? |

Most Clippy suggestions are worth considering. Some are worth declining. The important thing is to make the decision consciously.
:::

## A Review Rhythm

A small command rhythm catches many problems before review:

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo doc --no-deps
```

Each command answers a different question:

| Command | Question |
| --- | --- |
| `cargo fmt --all --check` | Is formatting stable? |
| `cargo clippy` | Does the code contain suspicious patterns? |
| `cargo test` | Does behavior still match expectations? |
| `cargo doc --no-deps` | Does public documentation build? |

During early learning, you can run the friendlier versions:

```bash
cargo fmt
cargo clippy
cargo test
```

The habit matters more than the exact strictness at first.

## Putting It All Together

A maintainable Rust project has more than compiling code:

```rust
/// Finds the default notebook name in a config file.
///
/// # Examples
///
/// ```
/// let config = "default=work\n";
/// assert_eq!(my_notes::default_notebook(config), Some("work"));
/// ```
pub fn default_notebook(config: &str) -> Option<&str> {
    config
        .lines()
        .find_map(|line| line.strip_prefix("default="))
        .map(str::trim)
}
```

The public function explains its promise. The example can be tested. Formatting is automatic. Clippy can review common suspicious patterns. Tests protect behavior.

Count back to the opener:

- Public API usage belongs in docs.
- Examples should stay accurate through doctests.
- Formatting should be handled by `rustfmt`.
- Suspicious code should get an automated first pass from Clippy.

This is the quiet side of idiomatic Rust: make good habits cheap enough that the team actually uses them.

## What's Next

You now have the core shape of ordinary Rust: ownership, borrowing, errors, traits, generics, collections, iterators, tests, and quality tooling. The next roadmap module moves into async and production Rust, where these same ideas meet I/O, concurrency, services, and deployment choices.

---

**References**

- [What is rustdoc? - The rustdoc book](https://doc.rust-lang.org/rustdoc/what-is-rustdoc.html)
- [Documentation tests - The rustdoc book](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html)
- [cargo fmt - The Cargo Book](https://doc.rust-lang.org/cargo/commands/cargo-fmt.html)
- [Clippy Documentation](https://doc.rust-lang.org/clippy/)
