---
title: "Real Projects"
description: "Turn Rust concepts into durable skill by building CLI tools, validators, API clients, indexers, and small services."
overview: "Rust clicks when concepts are forced into design decisions. Real projects make ownership, errors, traits, tests, and async work together."
tags: ["projects", "cli", "serde", "practice"]
order: 1
id: article-rust-async-and-production-real-projects
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Project Size](#project-size)
3. [A Project Ladder](#a-project-ladder)
4. [Add One Concept](#add-one-concept)
5. [Read Other Crates](#read-other-crates)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## The Problem

At this point, the roadmap has taught many Rust pieces: Cargo, modules, ownership, borrowing, `Option`, `Result`, traits, generics, collections, iterators, tests, async tasks, channels, and threads.

The danger is thinking the next step is simply more reading.

Rust becomes practical when the pieces collide in a project:

- A function wants to return a borrowed value, but the source text is local.
- A CLI needs useful errors instead of `unwrap`.
- A service wants concurrency, but shared state needs a boundary.

Those moments are where Rust starts to make sense. Build projects small enough to finish and large enough to force design.

## Project Size

Good learning projects should hurt a little, but not so much that the design collapses.

A project is too small if it only repeats one syntax shape. A project is too large if most of the time goes into framework setup, deployment accounts, or UI polish.

Use this target:

| Project size | Good sign |
| --- | --- |
| One evening | Reinforces one concept |
| One weekend | Forces a few modules and tests |
| One week | Requires error design and refactoring |
| One month | Becomes a real portfolio project |

Early Rust projects should usually live in the one-evening to one-week range. That is enough to meet the borrow checker in real design without getting buried.

## A Project Ladder

Start with projects that reuse the notes-app ideas from this roadmap:

| Project | What it teaches |
| --- | --- |
| Unit converter | Functions, parsing, `Result` |
| Word counter | Strings, slices, iterators |
| Todo list in memory | Structs, enums, `Vec<T>` |
| Todo list persisted to JSON | `serde`, files, error handling |
| Grep-like searcher | Lifetimes, borrowing, CLI arguments |
| Markdown note indexer | Filesystem traversal, ownership, maps |
| HTTP API client | External crates, async, domain models |
| CLI with subcommands | `clap`, modules, integration tests |
| Tiny web service | Tokio, routing, shared state |

Do not try to make every project production-grade. A learning project should have a sharp purpose.

:::expand[A project should force one new design decision]{kind="pattern"}
The best learning projects add one new design pressure at a time.

For example, a todo app can grow in layers:

| Version | New pressure |
| --- | --- |
| In-memory todos | `Vec<Todo>` and methods |
| Save to JSON | Serialization and file errors |
| Add CLI commands | Argument parsing and user messages |
| Add due dates | Domain modeling with enums and structs |
| Add tests | Public behavior and fixtures |

This works better than starting with "build a full productivity app." The smaller path gives you a clear reason to refactor.

When you add JSON persistence, the old `fn add(todo: Todo)` design may still work. When you add CLI commands, error messages matter more. When you add due dates, your data model changes. Those design turns are the learning.

If a project does not force any new decision, make it slightly bigger. If it forces ten new decisions at once, cut the scope.
:::

## Add One Concept

For each project, pick one concept to emphasize.

If the goal is ownership, write functions that borrow inputs and return owned outputs when needed. If the goal is error handling, avoid `unwrap` in normal application paths. If the goal is traits, define behavior that two types genuinely share.

This keeps practice from becoming vague.

```text
Project: Markdown note indexer
Focus: ownership-aware data flow
Constraint: parser helpers borrow text; index owns final entries
Done when: can search titles and tags from a saved index
```

The constraint matters. It creates the Rust lesson inside the project.

## Read Other Crates

After you build a small version, read source code from crates you use.

You do not need to understand everything. Look for:

- How public types are named.
- Where errors are defined.
- Whether APIs borrow or own inputs.
- How tests are organized.
- Which examples the crate documents first.

Rust documentation links to source for standard library items, and many crates on docs.rs expose source as well. Reading good Rust code is part of learning idiom.

## Putting It All Together

A good next project could be a markdown note indexer:

```text
note-indexer/
  Cargo.toml
  src/
    main.rs
    lib.rs
    parser.rs
    index.rs
    error.rs
  tests/
    index_test.rs
```

The project has real design pressure:

- `parser.rs` borrows markdown text and returns parsed pieces.
- `index.rs` owns searchable entries.
- `error.rs` names file and parse failures.
- `main.rs` stays thin and user-facing.
- tests cover empty files, missing titles, and tag lookup.

Count back to the opener:

- Ownership appears in parser boundaries.
- `Result` appears in file and parse paths.
- Collections appear in the search index.
- Tests prove behavior beyond compilation.

That is where Rust stops being a list of concepts and starts becoming a way to design programs.

## What's Next

Real projects teach the language. Production Rust asks a slightly different question: once the project lives longer, how should errors, logs, configuration, workspaces, dependencies, and release checks be shaped?

---

**References**

- [Command Line Applications in Rust](https://rust-cli.github.io/book/index.html)
- [Cargo Workspaces - The Rust Programming Language](https://doc.rust-lang.org/book/ch14-03-cargo-workspaces.html)
- [The Rust Standard Library](https://doc.rust-lang.org/std/)
