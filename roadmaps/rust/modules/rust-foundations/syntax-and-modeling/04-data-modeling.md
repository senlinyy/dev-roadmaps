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

`impl Note` means "methods for the `Note` type live here." The `&self` parameter means the method reads the note without taking ownership of it. If you know `this` in JavaScript or Python's `self`, start there, but add one Rust detail: `&self` is borrowed access, so the method can inspect the note without taking the note away from the caller. You do not need the full ownership model yet, but the shape is worth noticing. Many methods borrow `self` because they only need to inspect the value.

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

A variant is one named case of the enum. A `NoteStatus` value is `Draft`, `Published`, or `Archived`, but never all three at the same time.

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

:::expand[Make impossible states impossible]{kind="design"}
The deeper design idea behind enums is that a type can rule out bad combinations before the program runs.

Imagine a note model that tries to describe every state with separate fields:

```rust
struct Note {
    title: String,
    body: String,
    is_draft: bool,
    published_at: Option<String>,
    archived_reason: Option<String>,
}
```

This can represent valid notes, but it can also represent nonsense:

```rust
let note = Note {
    title: String::from("Rust notes"),
    body: String::from("Cargo creates projects"),
    is_draft: true,
    published_at: Some(String::from("2026-05-16")),
    archived_reason: Some(String::from("duplicate")),
};
```

Is this note a draft, a published note, or an archived note? The struct allowed all three meanings to exist at once. It can also represent quieter invalid states, such as `is_draft: false` with no publish date and no archive reason. That forces every caller to remember the same business rules.

An enum can make each state carry only the data that belongs to that state:

```rust
enum NoteState {
    Draft,
    Published { published_at: String },
    Archived { reason: String },
}
```

Then `Note` can keep the shared data separate from the state-specific data:

```rust
struct Note {
    title: String,
    body: String,
    state: NoteState,
}
```

The payoff appears when the code handles the state:

```rust
fn status_line(note: &Note) -> String {
    match &note.state {
        NoteState::Draft => String::from("draft"),
        NoteState::Published { published_at } => {
            format!("published at {published_at}")
        }
        NoteState::Archived { reason } => {
            format!("archived: {reason}")
        }
    }
}
```

The `Published` arm has access to `published_at` because that field only exists for published notes. The `Draft` arm cannot accidentally read an archive reason because drafts do not carry one. Experienced Rust code leans on this style because it moves rules out of scattered `if` checks and into the data model itself.
:::

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

The useful part is not only branching. The useful part is coverage. A pattern is the shape a match arm is looking for, such as `NoteStatus::Draft` or `Command::Add { title, body }`. A `match` over an enum must handle every variant unless you deliberately use a catch-all pattern.

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

:::expand[Parse commands into data first]{kind="pattern"}
A common Rust pattern is to turn loose input into typed data early, then run the rest of the program against that typed shape.

For a notes CLI, the raw input might start as strings:

```text
add "Rust notes" "Cargo creates projects"
search Cargo
list --pinned
```

The weak version is to keep passing strings around:

```rust
fn run(action: &str, first: Option<&str>, second: Option<&str>, pinned: bool) {
    if action == "add" {
        println!("saving {}", first.unwrap_or(""));
    } else if action == "search" {
        println!("searching for {}", first.unwrap_or(""));
    } else if action == "list" {
        println!("listing notes, pinned only: {pinned}");
    }
}
```

Now every caller has to remember which argument means what for each command. `second` matters for `add`, but not for `search`. `pinned` matters for `list`, but not for `add`.

The Rust-shaped version parses once:

```rust
enum Command {
    Add { title: String, body: String },
    Search { query: String },
    List { pinned_only: bool },
}
```

Then the behavior code can focus on real cases:

```rust
fn run(command: Command) {
    match command {
        Command::Add { title, body } => {
            println!("saving {title}: {} characters", body.len());
        }
        Command::Search { query } => {
            println!("searching for {query}");
        }
        Command::List { pinned_only } => {
            println!("listing notes, pinned only: {pinned_only}");
        }
    }
}
```

This split matters more as programs grow. Parsing is where you deal with messy input, missing arguments, invalid flags, and help text. After parsing succeeds, the rest of the program receives a `Command`.

That creates a useful boundary: outside the parser, invalid command shapes should not exist. `Add` always has the fields it needs. `List` carries the `pinned_only` choice directly. The rest of the program can match the enum instead of repeatedly asking what a string means.
:::

## Option

Rust does not use null as the normal way to say "maybe no value." It uses `Option<T>`:

```rust
fn first_match(notes: &[Note], query: &str) -> Option<&Note> {
    for note in notes {
        if note.title.contains(query) {
            return Some(note);
        }
    }

    None
}
```

The important idea is `Option<&Note>`: the function may return a borrowed note, or it may return no note. `Some(note)` means a match was found. `None` means the search finished without finding one.

:::expand[What the lifetime annotation would be doing]{kind="design"}
You may see a more explicit version of this function in Rust examples:

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

The `<'a>` syntax is a lifetime name. It does not mean "keep this value alive for a certain number of seconds." It names a relationship between borrowed values.

Here, the returned `&Note` must come from the input `notes` slice. The returned reference cannot outlive the notes it points into. The lifetime annotation says that relationship out loud: "the borrowed note I return is valid for the same borrow of `notes`."

Rust can infer that relationship in the simpler version:

```rust
fn first_match(notes: &[Note], query: &str) -> Option<&Note>
```

That is why the visible article uses the shorter form. The modeling lesson is `Option`: the search may find a note or may not. Lifetimes become the main lesson later, when borrowed data is the thing being modeled.
:::

Callers have to handle both cases:

```rust
match first_match(&notes, "Cargo") {
    Some(note) => println!("found: {}", note.title),
    None => println!("no match"),
}
```

That is Rust's modeling style in miniature. Uncertainty is not hidden. The type tells the caller what can happen.

:::expand[Option is a promise]{kind="pattern"}
`Option<T>` is strongest when absence is an expected part of the operation.

A search that finds no matching note is not broken. It is a normal outcome:

```rust
fn first_match<'a>(notes: &'a [Note], query: &str) -> Option<&'a Note>
```

The return type promises callers exactly two possibilities: `Some(note)` or `None`.

That promise would be too weak for a file read:

```rust
fn read_notes(path: &str) -> Option<String>
```

If this returns `None`, the caller does not know what happened. Was the file missing? Was permission denied? Was the data not valid UTF-8? For that kind of failure, `Result<T, E>` is usually a better model because it can carry the reason.

Use the return type to tell the caller what kind of uncertainty they are handling:

| Situation | Better shape | Why |
| --- | --- | --- |
| Search may find nothing | `Option<&Note>` | No match is expected and needs no explanation |
| Read may fail | `Result<String, std::io::Error>` | The caller needs the reason |
| List may be empty | `Vec<Note>` | An empty list already says there are no items |

Here is the file-read shape:

```rust
fn read_notes(path: &str) -> Result<String, std::io::Error> {
    std::fs::read_to_string(path)
}
```

Now the caller can decide what to do with the error:

```rust
match read_notes("notes.txt") {
    Ok(contents) => println!("{contents}"),
    Err(error) => eprintln!("could not read notes: {error}"),
}
```

The rule of thumb is: use `Option` when "nothing there" is enough information. Use `Result` when the caller needs to know why the operation failed.
:::

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
- [Recoverable Errors with Result](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html). Supports the distinction between expected absence and recoverable failure that should carry an error reason.
