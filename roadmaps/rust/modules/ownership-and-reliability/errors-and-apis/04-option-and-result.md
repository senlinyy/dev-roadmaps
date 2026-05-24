---
title: "Option And Result"
description: "Represent missing values and recoverable failures in Rust without null, exceptions, or casual unwraps."
overview: "After ownership, borrowing, strings, and slices, Rust uses the same explicit style for ordinary uncertainty: a value may be missing, or an operation may fail."
tags: ["option", "result", "match", "unwrap"]
order: 1
id: article-rust-ownership-and-reliability-option-and-result
---

## Table of Contents

1. [What Are Option And Result?](#what-are-option-and-result)
2. [Searching With Option](#searching-with-option)
3. [Reading Files With Result](#reading-files-with-result)
4. [Enums Carry The State](#enums-carry-the-state)
5. [Handling With Match](#handling-with-match)
6. [if let](#if-let)
7. [The Unwrap Trap](#the-unwrap-trap)
8. [Choosing Option Or Result](#choosing-option-or-result)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Are Option And Result?

The previous article showed how Rust makes owned data and borrowed views visible in types. Rust uses the same habit for two everyday cases: sometimes a value is missing, and sometimes an operation fails.

A notes app runs into both cases quickly:

- Searching for a note title may find no matching note.
- Reading a config file may fail because the file is missing.
- Parsing a setting may fail because the text has the wrong shape.

Rust represents these cases with ordinary values. `Option<T>` means a value may be present or absent. `Result<T, E>` means an operation may succeed with `T` or fail with error `E`.

Create a small project:

```bash
$ cargo new note-state
    Creating binary (application) `note-state` package
$ cd note-state
```

Put this program in `src/main.rs`:

```rust
fn main() {
    let tags = vec!["release", "ops"];

    println!("{:?}", tags.iter().position(|tag| *tag == "release"));
    println!("{:?}", tags.iter().position(|tag| *tag == "missing"));
    println!("{:?}", std::fs::read_to_string("notes.conf"));
}
```

Run it in a directory with no `notes.conf` file:

```bash
$ cargo run
   Compiling note-state v0.1.0 (/home/you/note-state)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.27s
     Running `target/debug/note-state`
Some(0)
None
Err(Os { code: 2, kind: NotFound, message: "No such file or directory" })
```

The first line is `Some(0)` because the search found the tag at index 0. The second line is `None` because the search completed without a match. The third line is `Err(...)` because the operating system said the file does not exist.

The state is part of the value. The caller does not have to remember that a special string, a null pointer, or a hidden exception might appear. The type says what can happen.

## Searching With Option

`Option<T>` is used when absence is a normal answer.

Here is a small note search:

```rust
#[derive(Debug)]
struct Note {
    title: String,
    body: String,
}

fn find_note<'a>(notes: &'a [Note], title: &str) -> Option<&'a Note> {
    notes.iter().find(|note| note.title == title)
}

fn main() {
    let notes = vec![
        Note {
            title: String::from("release checklist"),
            body: String::from("ship build"),
        },
        Note {
            title: String::from("incident notes"),
            body: String::from("collect timeline"),
        },
    ];

    println!("{:?}", find_note(&notes, "release checklist"));
    println!("{:?}", find_note(&notes, "missing"));
}
```

Run it:

```text
Some(Note { title: "release checklist", body: "ship build" })
None
```

The return type is `Option<&Note>`. Read that as "maybe a borrowed note." The first call returns `Some(...)` because a matching note exists. The second call returns `None` because no note has the requested title.

The lifetime annotation in `find_note<'a>` says the returned borrowed note comes from the borrowed `notes` slice. The function is not creating a new note. It is handing back a view of a note that already lives inside the caller's vector.

The two possible shapes are simple:

```rust
Some(value)
None
```

There is no note inside `None`. Code that wants the note has to handle that case.

## Reading Files With Result

`Result<T, E>` is used when failure has a reason worth keeping.

File reading is a good example:

```rust
fn main() {
    let config = std::fs::read_to_string("notes.conf");

    println!("{config:?}");
}
```

Run it before the file exists:

```text
Err(Os { code: 2, kind: NotFound, message: "No such file or directory" })
```

Now create the file:

```bash
$ printf 'default=release checklist\n' > notes.conf
$ cat notes.conf
default=release checklist
```

Run the program again:

```text
Ok("default=release checklist\n")
```

The same expression returned two different variants:

```rust
Ok(text)
Err(error)
```

`Ok` contains the file contents. `Err` contains the I/O error from the operating system. That error carries useful details such as `NotFound`, `PermissionDenied`, or another filesystem problem.

This is the difference between `Option` and `Result`. A missing search result usually needs no extra explanation. A failed file read usually does, because the caller may respond differently to "file missing" and "permission denied."

## Enums Carry The State

`Option` and `Result` are enums. An enum is a type whose value is one of a fixed set of variants.

Their simplified shapes look like this:

```rust
enum Option<T> {
    Some(T),
    None,
}

enum Result<T, E> {
    Ok(T),
    Err(E),
}
```

The angle-bracket names are type parameters. In `Option<&Note>`, `T` is `&Note`. In `Result<String, std::io::Error>`, `T` is `String` and `E` is `std::io::Error`.

This table shows the shape in the notes app:

| Expression | Type Shape | Possible Values |
| --- | --- | --- |
| `find_note(&notes, "release")` | `Option<&Note>` | `Some(&Note)` or `None` |
| `std::fs::read_to_string("notes.conf")` | `Result<String, io::Error>` | `Ok(String)` or `Err(io::Error)` |
| `"42".parse::<u32>()` | `Result<u32, ParseIntError>` | `Ok(42)` or `Err(ParseIntError)` |

The compiler tracks those shapes. If code tries to use an `Option<&Note>` as if it were definitely a `&Note`, Rust stops you.

The mechanism is the same idea as the enum from the previous module: a value has a current variant and, for some variants, a payload.

```text
Some(&Note)
  variant: Some
  payload: reference to a Note

None
  variant: None
  payload: none

Ok(String)
  variant: Ok
  payload: owned file contents

Err(io::Error)
  variant: Err
  payload: operating-system error details
```

When code writes `match maybe_note`, Rust checks the current variant. If it is `Some(note)`, the payload is available inside that branch as `note`. If it is `None`, there is no payload to extract. That is the actual step that replaces a null check: the program branches on the enum variant and only receives the inner value in the branch where that value exists.

## Handling With Match

The direct way to handle an enum is `match`.

Use `match` to print a note search result:

```rust
#[derive(Debug)]
struct Note {
    title: String,
    body: String,
}

fn find_note<'a>(notes: &'a [Note], title: &str) -> Option<&'a Note> {
    notes.iter().find(|note| note.title == title)
}

fn main() {
    let notes = vec![Note {
        title: String::from("release checklist"),
        body: String::from("ship build"),
    }];

    match find_note(&notes, "release checklist") {
        Some(note) => println!("found: {}", note.title),
        None => println!("no matching note"),
    }

    match find_note(&notes, "incident notes") {
        Some(note) => println!("found: {}", note.title),
        None => println!("no matching note"),
    }
}
```

Run it:

```text
found: release checklist
no matching note
```

The first `match` receives `Some(note)`, so it runs the first arm. The payload inside `Some` becomes the local name `note`, and only that branch can read `note.title`. The second `match` receives `None`, so it runs the second arm. There is no note payload in that branch, so the code cannot accidentally read a missing note. An arm is one branch of a `match`.

The same pattern handles `Result`:

```rust
fn main() {
    match std::fs::read_to_string("notes.conf") {
        Ok(text) => println!("loaded {} bytes", text.len()),
        Err(error) => println!("could not read config: {error}"),
    }
}
```

If `notes.conf` exists and contains one setting, the output might be:

```text
loaded 26 bytes
```

If the file is missing, the output is:

```text
could not read config: No such file or directory (os error 2)
```

The important part is that both paths are written down. Rust's `match` must cover every variant unless you explicitly use a catch-all pattern.

## if let

`match` is clear when both branches matter. Sometimes only one branch needs work.

This program prints a note only if it is present:

```rust
#[derive(Debug)]
struct Note {
    title: String,
}

fn main() {
    let maybe_note = Some(Note {
        title: String::from("release checklist"),
    });

    if let Some(note) = maybe_note {
        println!("opening {}", note.title);
    }
}
```

Output:

```text
opening release checklist
```

`if let Some(note) = maybe_note` means "if the value has the `Some` shape, pull out the note and run this block." If the value is `None`, the block is skipped.

This is useful for small optional actions: print a value if present, add a tag if found, or use a config override if the config contains one. When the missing case needs its own behavior, use `match`.

## The Unwrap Trap

`unwrap()` extracts the value from `Some` or `Ok`. It panics on `None` or `Err`.

This program compiles:

```rust
fn main() {
    let tags = vec!["release", "ops"];
    let index = tags.iter().position(|tag| *tag == "missing").unwrap();

    println!("{index}");
}
```

Run it:

```text
thread 'main' panicked at src/main.rs:3:58:
called `Option::unwrap()` on a `None` value
```

The panic is accurate. The search returned `None`, and `unwrap()` demanded a value anyway. A panic stops the current thread. In a command-line tool, that may end the process. In a server, a panic may abort a request or, depending on the runtime, bring down more of the program than intended.

`unwrap()` is useful in examples, tests, and short scripts where a crash is acceptable. In application code, it often hides a decision the program should make:

| Situation | Better Shape |
| --- | --- |
| Missing value is expected | Return or handle `Option` |
| Failure has a reason | Return or handle `Result` |
| Missing value means a config error | Convert `Option` to `Result` with a clear error |
| A value must exist because the code just created it | `expect("message")` can document the invariant |

Panics have legitimate uses in tests, examples, and unrecoverable situations. In this example, the issue is a signature that looks reliable while the body can crash during ordinary input.

## Choosing Option Or Result

Use `Option` when absence is the whole story. Use `Result` when the caller needs a reason for failure.

| Question | Prefer | Example |
| --- | --- | --- |
| Did a search find a value? | `Option<T>` | `notes.iter().find(...)` |
| Does this map contain a key? | `Option<&V>` | `settings.get("theme")` |
| Did file reading succeed? | `Result<String, io::Error>` | `read_to_string("notes.conf")` |
| Did parsing succeed? | `Result<u32, ParseIntError>` | `"42".parse::<u32>()` |
| Is a required setting missing? | `Result<T, ConfigError>` | `load_default_notebook(...)` |

A missing optional theme can be `None`. A missing required config entry should usually become an error because the caller needs to know why startup cannot continue.

That boundary is a design choice. Rust's types make the choice visible.

## Putting It All Together

The opening examples produced three values:

```text
Some("release")
None
Err(Os { code: 2, kind: NotFound, message: "No such file or directory" })
```

Those lines are the whole lesson in miniature. `Some` means a value is present. `None` means absence is a normal result. `Err` means an operation failed and carried a reason.

Rust makes callers deal with those shapes before they can use the inner value. `match` handles every branch directly. `if let` handles the branch you care about. `unwrap()` skips the decision and panics when the value is missing or failed.

The same habit from ownership is still present: important program states should be visible in the type, not hidden in a convention the caller might forget.

## What's Next

`Option` and `Result` explain how Rust represents missing values and recoverable failures. The next article shows how those values move through real functions with `Result` return types, custom error enums, and the `?` operator.

---

**References**

- [std::option::Option](https://doc.rust-lang.org/std/option/enum.Option.html)
- [std::result::Result](https://doc.rust-lang.org/std/result/enum.Result.html)
- [The Rust Programming Language: Recoverable Errors with Result](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html)
- [The Rust Programming Language: The match Control Flow Construct](https://doc.rust-lang.org/book/ch06-02-match.html)
- [The Rust Programming Language: Concise Control Flow with if let](https://doc.rust-lang.org/book/ch06-03-if-let.html)
