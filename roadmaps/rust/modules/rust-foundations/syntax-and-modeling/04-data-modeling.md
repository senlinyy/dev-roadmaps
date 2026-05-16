---
title: "Data Modeling"
description: "Use structs, enums, match, Option, and debug output to represent real program states clearly in small Rust programs."
overview: "Rust code becomes easier to understand when data shapes are explicit. This article follows a small notes program as loose values become structs, enums, and pattern matches."
tags: ["structs", "enums", "match", "option"]
order: 2
id: article-rust-rust-foundations-data-modeling
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Structs](#structs)
3. [Methods](#methods)
4. [Enums](#enums)
5. [Match](#match)
6. [Option](#option)
7. [Debug Output](#debug-output)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

A notes program starts with a few strings:

```rust
let title = "Rust notes";
let body = "Cargo creates projects";
let pinned = true;
```

This works for the first minute. Then the program needs more behavior. Some notes are drafts. Some are published. Some are archived. A search result may or may not have a match. A command can succeed, fail, or need more input.

If those states stay as loose strings and booleans, the code becomes hard to trust. What does `pinned = false` mean for an archived note? Can a draft have a publish date? What happens when search finds nothing?

Rust gives you two everyday modeling tools before you reach for anything fancy: structs for grouping data, and enums for naming possible states.

## Structs

A struct groups related fields into one named type:

```rust
struct Note {
    title: String,
    body: String,
    pinned: bool,
}
```

That definition says a `Note` has three fields. The field names matter because they make the data readable at the call site:

```rust
fn main() {
    let note = Note {
        title: String::from("Rust notes"),
        body: String::from("Cargo creates projects"),
        pinned: true,
    };

    println!("{}", note.title);
}
```

The field access `note.title` is direct and readable. You do not have to remember that the title was position `0` in a tuple.

The first practical gotcha is mutability. Rust does not let you mark only one field as mutable at the binding site. The binding is mutable or it is not:

```rust
fn main() {
    let mut note = Note {
        title: String::from("Rust notes"),
        body: String::from("Cargo creates projects"),
        pinned: false,
    };

    note.pinned = true;
}
```

That rule keeps the reading habit simple. When you see `let mut note`, the note value may change. When you see `let note`, it will not be reassigned or have fields changed through that binding.

## Methods

Functions can live near the type they operate on. Rust uses an `impl` block for methods:

```rust
struct Note {
    title: String,
    body: String,
    pinned: bool,
}

impl Note {
    fn summary(&self) -> String {
        format!("{}: {} characters", self.title, self.body.len())
    }
}
```

The `&self` parameter means the method reads the note without taking ownership of it. You do not need the full ownership model yet, but the shape is worth noticing. Many methods borrow `self` because they only need to inspect the value.

Calling the method looks like this:

```rust
fn main() {
    let note = Note {
        title: String::from("Rust notes"),
        body: String::from("Cargo creates projects"),
        pinned: true,
    };

    println!("{}", note.summary());
}
```

Methods keep behavior close to the data shape. That makes small programs easier to scan and larger programs easier to split later.

## Enums

A struct says, "this value has these fields." An enum says, "this value is one of these variants."

For note status, an enum is clearer than a pile of booleans:

```rust
enum NoteStatus {
    Draft,
    Published,
    Archived,
}
```

Now a note can store one status:

```rust
struct Note {
    title: String,
    body: String,
    status: NoteStatus,
}
```

That prevents impossible combinations such as `is_draft = true` and `is_archived = true` at the same time. The type says which states exist.

Enums can also carry data:

```rust
enum Command {
    Add { title: String, body: String },
    Search { query: String },
    List,
}
```

This is one of Rust's strengths. A command is not just a string that you parse and hope everyone remembers. It can be a named shape. `Add` carries a title and body. `Search` carries a query. `List` carries nothing.

## Match

`match` runs different code for different shapes:

```rust
fn describe_status(status: NoteStatus) -> &'static str {
    match status {
        NoteStatus::Draft => "draft",
        NoteStatus::Published => "published",
        NoteStatus::Archived => "archived",
    }
}
```

The useful part is not only branching. The useful part is coverage. A `match` over an enum must handle every variant unless you deliberately use a catch-all pattern.

That changes maintenance. If you add a new status later:

```rust
enum NoteStatus {
    Draft,
    Published,
    Archived,
    Deleted,
}
```

The compiler can point you to matches that forgot about `Deleted`. That is the type system helping with refactoring.

For command data, `match` can unpack the fields:

```rust
fn run(command: Command) {
    match command {
        Command::Add { title, body } => {
            println!("adding {title}: {} characters", body.len());
        }
        Command::Search { query } => {
            println!("searching for {query}");
        }
        Command::List => {
            println!("listing notes");
        }
    }
}
```

Read the arms as a decision table. Each command variant gets its own shape and behavior.

## Option

Rust does not use null as the normal way to say "maybe no value." It uses `Option<T>`:

```rust
fn first_match<'a>(notes: &'a [Note], query: &str) -> Option<&'a Note> {
    for note in notes {
        if note.title.contains(query) {
            return Some(note);
        }
    }

    None
}
```

The full lifetime syntax appears here only because the function returns a borrowed note from the input slice. Do not worry if that part is not comfortable yet. The important idea is `Option<&Note>`: the function may return a note, or it may return no note.

Callers have to handle both cases:

```rust
match first_match(&notes, "Cargo") {
    Some(note) => println!("found: {}", note.title),
    None => println!("no match"),
}
```

That is Rust's modeling style in miniature. Uncertainty is not hidden. The type tells the caller what can happen.

## Debug Output

While learning, you will often want to print a whole value. Add `Debug` with `derive`:

```rust
#[derive(Debug)]
enum NoteStatus {
    Draft,
    Published,
    Archived,
}

#[derive(Debug)]
struct Note {
    title: String,
    body: String,
    status: NoteStatus,
}
```

Now you can print with `:?`:

```rust
println!("{note:?}");
```

Use debug output as a learning tool, not as a permanent user interface. It is great for seeing structure while building examples. Later, if users need polished output, write formatting intentionally.

## Putting It All Together

The opening problem was loose data. A few strings and booleans were enough for a toy example, but they did not explain the real states of the program.

Rust's basic modeling tools give the program a clearer shape:

- Structs group related fields under one type.
- Methods attach behavior to the data they read or change.
- Enums name the possible states or commands.
- `match` forces each variant to be considered.
- `Option<T>` makes absence visible.
- `Debug` output helps you inspect values while learning.

This is the first place Rust starts to feel different in a good way. You are not only writing code that works today. You are writing types that make future mistakes harder to hide.

## What's Next

The next article shows how to organize this code once one file becomes crowded. You will split a small Rust project into `main.rs`, `lib.rs`, modules, public functions, and basic tests.

---

**References**

- [Defining and Instantiating Structs](https://doc.rust-lang.org/stable/book/ch05-01-defining-structs.html). Supports struct definitions, field access, and struct mutability behavior.
- [Methods](https://doc.rust-lang.org/book/ch05-03-method-syntax.html). Supports `impl` blocks and method syntax.
- [Enums and Pattern Matching](https://doc.rust-lang.org/book/ch06-00-enums.html). Supports enums, `Option`, and pattern matching as core modeling tools.
- [Defining an Enum](https://doc.rust-lang.org/stable/book/ch06-01-defining-an-enum.html). Supports enums as named variants and `Option<T>` as the standard present-or-absent type.
- [match](https://doc.rust-lang.org/std/keyword.match.html). Supports `match` as pattern-based control flow with exhaustive handling.
