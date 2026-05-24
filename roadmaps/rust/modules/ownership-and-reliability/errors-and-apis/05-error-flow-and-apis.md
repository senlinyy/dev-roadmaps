---
title: "Error Flow And APIs"
description: "Write fallible Rust functions that return errors clearly, use the question-mark operator, and choose API input types deliberately."
overview: "Option and Result make absence and failure visible. This article shows how those values move through real functions without turning the code into a wall of match statements."
tags: ["result", "question-mark", "api-design", "errors"]
order: 2
id: article-rust-ownership-and-reliability-error-flow-and-apis
---

## Table of Contents

1. [What Is Error Flow?](#what-is-error-flow)
2. [Start With The File](#start-with-the-file)
3. [Return Result](#return-result)
4. [Name The Error](#name-the-error)
5. [The Question Mark Operator](#the-question-mark-operator)
6. [Convert Option To Result](#convert-option-to-result)
7. [Choose Borrowed Inputs](#choose-borrowed-inputs)
8. [Handle Errors At The Boundary](#handle-errors-at-the-boundary)
9. [Putting It All Together](#putting-it-all-together)
10. [Toward Idiomatic Rust](#toward-idiomatic-rust)

## What Is Error Flow?

The previous article introduced `Option` for missing values and `Result` for recoverable failures. A real function often has to move both through the same piece of code.

The notes app has a small config file. The file chooses which notebook opens by default:

```text
default=release checklist
theme=dark
```

The program needs a helper with this job: read the file, find the `default=` line, and return the notebook name. Three things can happen:

- The file can be read successfully and contain the setting.
- The file read can fail because the file is missing or unreadable.
- The file can exist but have no `default=` line.

Error flow is the path those outcomes take through the program. A good Rust API makes that path visible in the return type.

Create a project:

```bash
$ cargo new note-config
    Creating binary (application) `note-config` package
$ cd note-config
```

This article builds the config loader in stages. Each stage has a different function signature, and the signature is the part to watch.

## Start With The File

Create a config file and inspect it from the shell:

```bash
$ printf 'default=release checklist\ntheme=dark\n' > notes.conf
$ cat notes.conf
default=release checklist
theme=dark
```

The output confirms the file has two lines. The loader only cares about the line that starts with `default=`.

A direct Rust version might look like this:

```rust
fn load_default_notebook(path: &str) -> String {
    let text = std::fs::read_to_string(path).unwrap();
    let line = text
        .lines()
        .find(|line| line.starts_with("default="))
        .unwrap();

    line.trim_start_matches("default=").trim().to_string()
}

fn main() {
    let notebook = load_default_notebook("notes.conf");

    println!("opening {notebook}");
}
```

Run it with the valid file:

```bash
$ cargo run
   Compiling note-config v0.1.0 (/home/you/note-config)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.30s
     Running `target/debug/note-config`
opening release checklist
```

The happy path works. The signature says `String`, which means callers see a function that always returns a notebook name.

Now remove the config file and run the same program:

```bash
$ rm notes.conf
$ cargo run
     Running `target/debug/note-config`
thread 'main' panicked at src/main.rs:2:46:
called `Result::unwrap()` on an `Err` value: Os { code: 2, kind: NotFound, message: "No such file or directory" }
```

The function did not return a `String`. It panicked while trying to unwrap a failed file read. The signature hid that possibility from the caller.

That is the problem `Result` solves. A fallible function should return a fallible type.

## Return Result

A first honest signature can return the standard I/O error directly:

```rust
use std::io;

fn load_config(path: &str) -> Result<String, io::Error> {
    std::fs::read_to_string(path)
}

fn main() {
    match load_config("notes.conf") {
        Ok(text) => println!("loaded {} bytes", text.len()),
        Err(error) => println!("could not read config: {error}"),
    }
}
```

Run it with no config file:

```text
could not read config: No such file or directory (os error 2)
```

Now create the file again:

```bash
$ printf 'default=release checklist\ntheme=dark\n' > notes.conf
$ cargo run
     Running `target/debug/note-config`
loaded 37 bytes
```

The return type is:

```text
Result<String, io::Error>
```

Read it as "either file text or an I/O error." The caller must handle both shapes before it can get the text.

This version handles file reading, but it does not handle the missing `default=` setting yet. A missing line is not an I/O error. The file was read successfully. The content failed the app's rule.

## Name The Error

When a function can fail for application-specific reasons, give those reasons names.

For the config loader, use an enum:

```rust
#[derive(Debug)]
enum ConfigError {
    ReadFailed { path: String, message: String },
    MissingDefault,
}
```

The first variant means the file could not be read. It stores the path and the operating system's message. The second variant means the file was readable but did not contain a required setting.

Now write the loader without `unwrap()`:

```rust
#[derive(Debug)]
enum ConfigError {
    ReadFailed { path: String, message: String },
    MissingDefault,
}

fn load_default_notebook(path: &str) -> Result<String, ConfigError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) => {
            return Err(ConfigError::ReadFailed {
                path: path.to_string(),
                message: error.to_string(),
            });
        }
    };

    let line = match text.lines().find(|line| line.starts_with("default=")) {
        Some(line) => line,
        None => return Err(ConfigError::MissingDefault),
    };

    Ok(line.trim_start_matches("default=").trim().to_string())
}
```

The signature now says:

```text
Result<String, ConfigError>
```

That means:

| Variant | Meaning |
| --- | --- |
| `Ok(String)` | The default notebook name was loaded |
| `Err(ConfigError::ReadFailed { ... })` | The file could not be read |
| `Err(ConfigError::MissingDefault)` | The file had no `default=` line |

The function still follows the same human steps as the shell session: read the file, scan lines, extract the text after `default=`. The difference is that every early exit is now a value the caller can handle.

## The Question Mark Operator

The manual `match` around `read_to_string` is clear, but it is noisy. Rust's question mark operator, `?`, is the usual shortcut for "if this is an error, return that error from the current function."

This version keeps the same behavior:

```rust
#[derive(Debug)]
enum ConfigError {
    ReadFailed { path: String, message: String },
    MissingDefault,
}

fn load_default_notebook(path: &str) -> Result<String, ConfigError> {
    let text = std::fs::read_to_string(path).map_err(|error| {
        ConfigError::ReadFailed {
            path: path.to_string(),
            message: error.to_string(),
        }
    })?;

    let line = match text.lines().find(|line| line.starts_with("default=")) {
        Some(line) => line,
        None => return Err(ConfigError::MissingDefault),
    };

    Ok(line.trim_start_matches("default=").trim().to_string())
}
```

The important expression is:

```rust
std::fs::read_to_string(path).map_err(|error| {
    ConfigError::ReadFailed {
        path: path.to_string(),
        message: error.to_string(),
    }
})?
```

Read it from left to right. `read_to_string(path)` returns `Result<String, io::Error>`. `map_err(...)` changes the error side from `io::Error` into `ConfigError`. The `?` then checks the result. If it is `Ok(text)`, the text is assigned to `text`. If it is `Err(error)`, the function returns early with that error.

The `?` operator does not hide a panic. It is return-flow shorthand for `Result` and `Option`.

The compiler treats that line like a small `match` around the `Result`:

```rust
let text = match std::fs::read_to_string(path).map_err(|error| {
    ConfigError::ReadFailed {
        path: path.to_string(),
        message: error.to_string(),
    }
}) {
    Ok(text) => text,
    Err(error) => return Err(error),
};
```

That expansion shows the mechanism. The success payload is unwrapped into the local variable. The error payload is returned from `load_default_notebook` immediately. The caller still receives a `Result<String, ConfigError>`; the `?` operator only makes the early return small enough to read.

## Convert Option To Result

The line search returns an `Option<&str>`:

```rust
text.lines().find(|line| line.starts_with("default="))
```

That makes sense for `find`: it either finds a line or returns `None`. Inside the config loader, a missing default is an error. Convert the `Option` into a `Result` with `ok_or`:

```rust
fn load_default_notebook(path: &str) -> Result<String, ConfigError> {
    let text = std::fs::read_to_string(path).map_err(|error| {
        ConfigError::ReadFailed {
            path: path.to_string(),
            message: error.to_string(),
        }
    })?;

    let line = text
        .lines()
        .find(|line| line.starts_with("default="))
        .ok_or(ConfigError::MissingDefault)?;

    Ok(line.trim_start_matches("default=").trim().to_string())
}
```

The expression:

```rust
.ok_or(ConfigError::MissingDefault)?
```

means "turn `Some(line)` into `Ok(line)`, turn `None` into `Err(ConfigError::MissingDefault)`, and use `?` to return early on the error."

Read that as two mechanical steps:

```text
find(...) returns Option<&str>

Some(line)
  -> ok_or(...) changes it to Ok(line)
  -> ? extracts line and continues

None
  -> ok_or(...) changes it to Err(ConfigError::MissingDefault)
  -> ? returns Err(ConfigError::MissingDefault)
```

Nothing special happens to the line itself. It is still a borrowed `&str` view into the loaded config text. The conversion only changes the control-flow wrapper from "maybe present" to "success or named error."

This is a common Rust pattern. A search, map lookup, or parser step may naturally produce `Option`. At an API boundary, missing data may need to become a named error.

## Choose Borrowed Inputs

The loader accepts `path: &str`:

```rust
fn load_default_notebook(path: &str) -> Result<String, ConfigError>
```

That choice matters. The function only needs to read the path while it runs. It does not store the path as its own long-lived value, except when it builds an error message for the failed case. Accepting `&str` lets callers pass a string literal or a borrowed `String`:

```rust
fn main() {
    let path = String::from("notes.conf");

    let first = load_default_notebook("notes.conf");
    let second = load_default_notebook(&path);

    println!("{first:?}");
    println!("{second:?}");
}
```

The return type owns the notebook name:

```rust
Result<String, ConfigError>
```

That is also deliberate. The notebook name is extracted from `text`, and `text` is a local `String` inside the function. When the function returns, `text` will be dropped. Returning a borrowed `&str` into that local string would create a dangling reference. Returning an owned `String` gives the caller a value that remains valid after the loader finishes.

The signature says the whole story:

| Part | Meaning |
| --- | --- |
| `path: &str` | Borrow the path during the call |
| `Result<..., ConfigError>` | The function can fail in named ways |
| `String` inside `Ok` | Return an owned notebook name |

Good Rust APIs often come from this kind of plain reading.

## Handle Errors At The Boundary

Library-style functions usually return errors. The outer boundary of the program decides what to print, log, retry, or exit with.

Use this complete program:

```rust
#[derive(Debug)]
enum ConfigError {
    ReadFailed { path: String, message: String },
    MissingDefault,
}

fn load_default_notebook(path: &str) -> Result<String, ConfigError> {
    let text = std::fs::read_to_string(path).map_err(|error| {
        ConfigError::ReadFailed {
            path: path.to_string(),
            message: error.to_string(),
        }
    })?;

    let line = text
        .lines()
        .find(|line| line.starts_with("default="))
        .ok_or(ConfigError::MissingDefault)?;

    Ok(line.trim_start_matches("default=").trim().to_string())
}

fn main() {
    match load_default_notebook("notes.conf") {
        Ok(notebook) => println!("opening {notebook}"),
        Err(ConfigError::ReadFailed { path, message }) => {
            println!("could not read {path}: {message}");
        }
        Err(ConfigError::MissingDefault) => {
            println!("config is missing the default setting");
        }
    }
}
```

Run it with a good file:

```bash
$ printf 'default=release checklist\ntheme=dark\n' > notes.conf
$ cargo run
     Running `target/debug/note-config`
opening release checklist
```

Run it with a file that is missing the setting:

```bash
$ printf 'theme=dark\n' > notes.conf
$ cargo run
     Running `target/debug/note-config`
config is missing the default setting
```

Run it with no file:

```bash
$ rm notes.conf
$ cargo run
     Running `target/debug/note-config`
could not read notes.conf: No such file or directory (os error 2)
```

The three outputs correspond to the three states named in the type. The loader stays focused on loading. The `main` function decides what the user sees.

That split keeps error flow readable. Inner functions return structured information. Outer code turns that information into process behavior.

## Putting It All Together

The first version of the loader returned `String` and used `unwrap()`:

```rust
fn load_default_notebook(path: &str) -> String
```

That signature promised a notebook name even though ordinary input could make the function panic.

The final version returns:

```rust
fn load_default_notebook(path: &str) -> Result<String, ConfigError>
```

This signature says four useful things:

- The path is borrowed during the call.
- The success value is an owned `String`.
- The function can fail.
- The failures have names the caller can match on.

Inside the function, `?` keeps the happy path readable while preserving early returns. `map_err` changes low-level I/O errors into the app's error type. `ok_or` turns a missing line into a named failure. At the boundary, `main` decides how each outcome should be reported.

That is Rust's reliability style in a small form. Ownership says who is responsible for data. Borrowing says who can access data temporarily. `Result` says which calls can fail and what the caller must decide next.

## Toward Idiomatic Rust

The next module can build on this foundation. Traits, generics, iterators, tests, documentation, and linting all become easier when data ownership and error flow are already explicit.

In production Rust, you will also see helper crates such as `thiserror` for defining error types and `anyhow` for application-level error reporting. Those tools are useful after the basic model is clear. The model stays the same: fallible work returns `Result`, missing optional data uses `Option`, and APIs show callers what kind of access and failure they should expect.

---

**References**

- [The Rust Programming Language: Recoverable Errors with Result](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html)
- [The Rust Programming Language: To panic! or Not to panic!](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html)
- [std::result::Result](https://doc.rust-lang.org/std/result/enum.Result.html)
- [std::option::Option::ok_or](https://doc.rust-lang.org/std/option/enum.Option.html#method.ok_or)
- [std::fs::read_to_string](https://doc.rust-lang.org/std/fs/fn.read_to_string.html)
