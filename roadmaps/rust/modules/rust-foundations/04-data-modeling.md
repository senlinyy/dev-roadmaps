---
title: "Data Modeling"
description: "Use structs, methods, enums, match, Option, and Debug output to represent small Rust states clearly."
overview: "Rust programs become easier to read when important states are represented with types. This article introduces the main tools for modeling small pieces of data before ownership and error flow get deeper later."
tags: ["structs", "enums", "option", "match"]
order: 4
id: article-rust-rust-foundations-data-modeling
aliases:
  - rust-foundations/syntax-and-modeling/04-data-modeling.md
  - roadmaps/rust/modules/rust-foundations/syntax-and-modeling/04-data-modeling.md
  - child-syntax-and-modeling-04-data-modeling
---

## Table of Contents

1. [What Is Data Modeling?](#what-is-data-modeling)
2. [Structs](#structs)
3. [Methods](#methods)
4. [Enums](#enums)
5. [match](#match)
6. [Option](#option)
7. [Debug Output](#debug-output)
8. [Choosing the Right Shape](#choosing-the-right-shape)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is Data Modeling?

If you are coming from JavaScript or Python, you may be used to starting with plain objects or dictionaries. You add fields as the program needs them, then rely on tests and conventions to keep the shape consistent.

Rust asks for more of that shape up front. A Rust type says which fields exist, which states are possible, and which code is allowed to build or change a value. That extra structure can feel slow for a tiny script, but it becomes useful as soon as a program has real states to protect.

Imagine a small notes program. A note has a title and body. It may be a draft, published, or archived. It may have a due date, or it may have no due date. In a loose model, those facts might be scattered across strings and booleans:

```rust
let title = "Deploy notes";
let body = "Remember the release checklist";
let is_published = true;
let is_archived = true;
let publish_url = "";
```

That shape lets confusing states appear. A note can be both published and archived. A published note can have an empty URL. Another function has to guess which combination is valid.

Rust gives you better tools for saying what the data means:

- A `struct` groups fields that belong together.
- A method puts behavior next to the type it works on.
- An `enum` names the possible states of a value.
- `match` makes code handle every enum variant.
- `Option<T>` says a value may be present or absent.

This article builds that notes model one step at a time.

## Structs

A struct groups named fields into one type. Start with the simplest useful note:

```rust
struct Note {
    title: String,
    body: String,
}
```

This says every `Note` value has a `title` and a `body`, and both are owned `String` values. The fields belong together. Passing a `Note` around is clearer than passing two unrelated strings and hoping every function keeps them in the same order.

Create a value by naming the fields:

```rust
fn main() {
    let note = Note {
        title: String::from("Deploy notes"),
        body: String::from("Remember the release checklist"),
    };

    println!("{}", note.title);
}
```

The output is:

```text
Deploy notes
```

The `note.title` syntax reads a field. Because the field name is part of the access, the code stays readable even when the struct grows.

Structs also prevent incomplete values. This code is rejected because the `body` field is missing:

```rust
let note = Note {
    title: String::from("Deploy notes"),
};
```

The compiler knows the shape of `Note`, so it can catch the missing field immediately. That is one of the quiet benefits of modeling data with types: the compiler can help only with rules the code expresses.

## Methods

Methods are functions attached to a type. They live inside an `impl` block.

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
```

The `impl Note` block says these methods belong to `Note`. The method `new` builds a `Note` from borrowed text. It returns `Self`, which means `Note` inside this `impl` block.

The method `summary` takes `&self`. That means it borrows the note and reads it. It does not take ownership of the note, and it does not change the note.

Using the methods looks like this:

```rust
fn main() {
    let note = Note::new("Deploy notes", "Remember the release checklist");

    println!("{}", note.summary());
    println!("{}", note.title);
}
```

The output is:

```text
Deploy notes: Remember the release checklist
Deploy notes
```

The second print still works because `summary` borrowed the note. If `summary` had taken `self` instead of `&self`, the method would consume the note, and the later `note.title` access would fail.

Methods are useful because they keep behavior near the data shape. A reader can find the fields and the basic operations in the same part of the code.

## Enums

An enum says a value can be one of several named variants. That is the right shape for a note status.

```rust
enum NoteStatus {
    Draft,
    Published,
    Archived,
}
```

Now the status is one value with three possible states. A note cannot accidentally be both `Draft` and `Archived` at the same time because one enum value has one variant at a time.

Add the status to the struct:

```rust
struct Note {
    title: String,
    body: String,
    status: NoteStatus,
}
```

Create a draft note:

```rust
let note = Note {
    title: String::from("Deploy notes"),
    body: String::from("Remember the release checklist"),
    status: NoteStatus::Draft,
};
```

The `NoteStatus::Draft` syntax names the `Draft` variant inside the `NoteStatus` enum.

Enum variants can also carry data. A published note probably needs the URL where readers can find it:

```rust
enum NoteStatus {
    Draft,
    Published { url: String },
    Archived,
}
```

This is a stronger model. A note in the `Published` state carries a URL with that state. A draft or archived note does not have a publish URL field sitting around unused.

This is one of Rust's most useful design habits: put state-specific data inside the state that needs it.

## match

The `match` expression handles each possible shape of a value. With enums, it is the tool that makes every variant visible.

```rust
fn status_label(status: &NoteStatus) -> String {
    match status {
        NoteStatus::Draft => String::from("draft"),
        NoteStatus::Published { url } => format!("published at {url}"),
        NoteStatus::Archived => String::from("archived"),
    }
}
```

Read the signature first. `status_label` borrows a `NoteStatus` and returns an owned `String`.

The `match status` line says Rust should compare the value against each pattern. The first arm handles `Draft`. The second arm handles `Published` and pulls out the `url` field. The third arm handles `Archived`.

Each arm produces a `String`, so the whole `match` expression produces a `String`.

Use it like this:

```rust
fn main() {
    let status = NoteStatus::Published {
        url: String::from("/notes/deploy"),
    };

    println!("{}", status_label(&status));
}
```

The output is:

```text
published at /notes/deploy
```

The compiler checks that the match is exhaustive. Exhaustive means every possible variant is handled. If you add a new enum variant later, Rust can point at every `match` expression that needs a decision for the new state.

That is the big payoff. The model and the control flow stay connected.

## Option

Some fields are genuinely optional. A note may have a due date, or it may have no due date. Rust represents that with `Option<T>`.

```rust
struct Note {
    title: String,
    body: String,
    status: NoteStatus,
    due: Option<String>,
}
```

`Option<String>` means the field is either `Some(String)` or `None`. The type itself tells the reader that absence is expected.

Create a note with no due date:

```rust
let note = Note {
    title: String::from("Deploy notes"),
    body: String::from("Remember the release checklist"),
    status: NoteStatus::Draft,
    due: None,
};
```

Create one with a due date:

```rust
let note = Note {
    title: String::from("Deploy notes"),
    body: String::from("Remember the release checklist"),
    status: NoteStatus::Draft,
    due: Some(String::from("2026-06-01")),
};
```

Code that reads the due date must handle both cases:

```rust
fn due_label(note: &Note) -> String {
    match &note.due {
        Some(date) => format!("due {date}"),
        None => String::from("no due date"),
    }
}
```

The `Some(date)` arm handles the present value. The `None` arm handles absence. There is no casual null access hidden in the program. The optional shape is part of the type, and the match makes both cases visible.

Use `Option` when absence is an ordinary, expected state. A search that may find no result, a user profile that may not have an avatar, and a note that may not have a due date are all common examples.

## Debug Output

While learning Rust, you often want to inspect a value quickly. The `Debug` trait supports developer-facing output through the `{:?}` formatter.

Ask Rust to derive `Debug` for your types:

```rust
#[derive(Debug)]
struct Note {
    title: String,
    body: String,
    status: NoteStatus,
    due: Option<String>,
}

#[derive(Debug)]
enum NoteStatus {
    Draft,
    Published { url: String },
    Archived,
}
```

The `#[derive(Debug)]` attribute asks the compiler to generate a basic debug representation for the type.

Now print with `{:?}`:

```rust
fn main() {
    let note = Note {
        title: String::from("Deploy notes"),
        body: String::from("Remember the release checklist"),
        status: NoteStatus::Published {
            url: String::from("/notes/deploy"),
        },
        due: Some(String::from("2026-06-01")),
    };

    println!("{note:?}");
}
```

The output looks like this:

```text
Note { title: "Deploy notes", body: "Remember the release checklist", status: Published { url: "/notes/deploy" }, due: Some("2026-06-01") }
```

Debug output is for developers. It is great for tests, learning, and quick inspection. It is usually not the final user-facing text for an application. For user-facing text, write a method or implement the display behavior you want.

The pretty debug formatter is useful for nested values:

```rust
println!("{note:#?}");
```

That prints the same value across multiple lines:

```text
Note {
    title: "Deploy notes",
    body: "Remember the release checklist",
    status: Published {
        url: "/notes/deploy",
    },
    due: Some(
        "2026-06-01",
    ),
}
```

When a model feels confusing, debug output can show the actual shape of the value your code built.

## Choosing the Right Shape

Rust gives you several small modeling tools. The trick is choosing the one that matches the meaning of the data.

| Situation | Rust shape | Why |
| --- | --- | --- |
| Several fields belong together | `struct` | The fields travel as one named value. |
| Behavior belongs to a type | method in `impl` | The operation is easy to find near the data. |
| A value has one of several named states | `enum` | Only one state can exist at a time. |
| Every state needs handling | `match` | The compiler checks that all variants are covered. |
| A value may be absent | `Option<T>` | The type makes absence visible. |
| A value needs quick developer inspection | `#[derive(Debug)]` | `{:?}` can print the shape while learning or testing. |

Use a struct when the question is "what fields belong together?" Use an enum when the question is "which state is this value in?" Use `Option` when "missing" is a normal answer the caller must handle.

Those choices make invalid states harder to write. A note status modeled as an enum cannot be draft and archived at the same time. A due date modeled as `Option<String>` forces code to handle the missing case. A method that takes `&self` makes it clear that it reads the note rather than consuming it.

## Putting It All Together

Here is the small model in one place:

```rust
#[derive(Debug)]
struct Note {
    title: String,
    body: String,
    status: NoteStatus,
    due: Option<String>,
}

#[derive(Debug)]
enum NoteStatus {
    Draft,
    Published { url: String },
    Archived,
}

impl Note {
    fn new(title: &str, body: &str) -> Self {
        Self {
            title: title.to_string(),
            body: body.to_string(),
            status: NoteStatus::Draft,
            due: None,
        }
    }

    fn set_due(&mut self, due: &str) {
        self.due = Some(due.to_string());
    }

    fn publish(&mut self, url: &str) {
        self.status = NoteStatus::Published {
            url: url.to_string(),
        };
    }

    fn summary(&self) -> String {
        format!("{} ({})", self.title, status_label(&self.status))
    }
}

fn status_label(status: &NoteStatus) -> String {
    match status {
        NoteStatus::Draft => String::from("draft"),
        NoteStatus::Published { url } => format!("published at {url}"),
        NoteStatus::Archived => String::from("archived"),
    }
}

fn main() {
    let mut note = Note::new("Deploy notes", "Remember the release checklist");

    note.set_due("2026-06-01");
    note.publish("/notes/deploy");

    println!("{}", note.summary());
    println!("{note:#?}");
}
```

The program starts with a draft note. The mutable binding lets `main` call methods that change the note. `set_due` turns `None` into `Some(String)`. `publish` changes the enum state and stores the URL inside the published state. `summary` borrows the note and returns user-facing text. The final debug print shows the full model.

The important design habit is the same throughout the article: make the program states explicit. Once the states are explicit, Rust can help you keep them handled.

## What's Next

The note model now has useful data shapes, but real projects rarely stay in one file. The next article explains how Cargo packages, crates, modules, paths, visibility, and tests give a Rust project a readable file structure.

---

**References**

- [The Rust Programming Language: Defining and Instantiating Structs](https://doc.rust-lang.org/book/ch05-01-defining-structs.html) - Official guide to structs and field syntax.
- [The Rust Programming Language: Method Syntax](https://doc.rust-lang.org/book/ch05-03-method-syntax.html) - Official explanation of `impl`, methods, and `self`.
- [The Rust Programming Language: Enums and Pattern Matching](https://doc.rust-lang.org/book/ch06-00-enums.html) - Official guide to enums, enum data, `Option`, and `match`.
- [The Rust Programming Language: The match Control Flow Construct](https://doc.rust-lang.org/book/ch06-02-match.html) - Official explanation of `match` and exhaustive pattern handling.
- [The Rust Standard Library: Debug](https://doc.rust-lang.org/std/fmt/trait.Debug.html) - Official documentation for the `Debug` formatting trait.
