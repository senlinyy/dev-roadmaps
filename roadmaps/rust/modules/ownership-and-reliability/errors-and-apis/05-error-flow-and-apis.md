---
title: "Error Flow And APIs"
description: "Write fallible Rust functions that return errors clearly, use the question-mark operator, and choose API input types deliberately."
overview: "Option and Result make absence and failure visible. This article shows how those values move through real functions without turning the code into a wall of match statements."
tags: ["result", "question-mark", "api-design", "errors"]
order: 2
id: article-rust-ownership-and-reliability-error-flow-and-apis
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Return Result](#return-result)
3. [Wrapping An Error](#wrapping-an-error)
4. [The Question Mark Operator](#the-question-mark-operator)
5. [Error Boundaries](#error-boundaries)
6. [From Option To Result](#from-option-to-result)
7. [Borrow Or Own Inputs](#borrow-or-own-inputs)
8. [Small Flexible APIs](#small-flexible-apis)
9. [Putting It All Together](#putting-it-all-together)
10. [Toward Idiomatic Rust](#toward-idiomatic-rust)

## The Problem

The previous article gave us the two basic shapes: `Option` for ordinary absence and `Result` for recoverable failure. Fallible means "can fail during normal operation." Now the notes app needs a real fallible function.

The feature is small. Read a config file, find a `default=` line, and return the notebook name to the rest of the program.

The first version is easy to write:

```rust
fn load_default_notebook(path: &str) -> String {
    let text = std::fs::read_to_string(path).unwrap();
    let line = text
        .lines()
        .find(|line| line.starts_with("default="))
        .unwrap();

    line.trim_start_matches("default=").to_string()
}
```

This code is short because it hides decisions:

- If the file cannot be read, the program panics.
- If the file has no `default=` line, the program panics.
- The signature promises a `String` even though the function may not produce one.

The better Rust version does not try to make failure disappear. It returns failure as part of the API. The trick is keeping that honest code readable.

## Return Result

A fallible function should usually return `Result<T, E>`.

The success type is the useful value the caller wanted. The error type is the reason the function could not produce it.

For the config loader, the success value is a notebook name. The function can fail for two simple reasons: the file cannot be read, or the file does not contain a default notebook.

Start with a small error enum:

```rust
use std::io;

#[derive(Debug)]
enum ConfigError {
    Read(io::Error),
    MissingDefault,
}
```

Then make the return type honest:

```rust
fn find_default(text: &str) -> Option<&str> {
    text.lines()
        .find(|line| line.starts_with("default="))
        .map(|line| line.trim_start_matches("default="))
}

fn load_default_notebook(path: &str) -> Result<String, ConfigError> {
    let text = std::fs::read_to_string(path)
        .map_err(ConfigError::Read)?;

    match find_default(&text) {
        Some(name) => Ok(name.to_string()),
        None => Err(ConfigError::MissingDefault),
    }
}
```

The function now says what can happen. If it succeeds, callers get a `String`. If it fails, callers get a `ConfigError`.

This is the important API shift. A function that returns `String` says, "I can give you a string." A function that returns `Result<String, ConfigError>` says, "I can try to give you a string, and if I cannot, I will tell you why."

## Wrapping An Error

This line is compact enough that it deserves a slower reading:

```rust
let text = std::fs::read_to_string(path)
    .map_err(ConfigError::Read)?;
```

`std::fs::read_to_string(path)` returns `Result<String, io::Error>`. The notes app does not want to expose raw `io::Error` as the whole public error story, so `map_err(ConfigError::Read)` converts the error side:

```text
Ok(text)           stays Ok(text)
Err(io_error)      becomes Err(ConfigError::Read(io_error))
```

Only after that conversion does `?` run. If the read succeeded, the `String` is taken out of `Ok` and stored in `text`. If the read failed, the function returns `Err(ConfigError::Read(error))` immediately.

## The Question Mark Operator

The `?` operator keeps fallible code from becoming a staircase of nested `match` blocks.

In a function that returns `Result`, placing `?` after another `Result` means:

```text
If this is Ok(value), take the value out and keep going.
If this is Err(error), return the error from this function now.
```

This line uses `?`:

```rust
let text = std::fs::read_to_string(path)
    .map_err(ConfigError::Read)?;
```

Without `?`, the same logic is noisier:

```rust
let text = match std::fs::read_to_string(path) {
    Ok(text) => text,
    Err(error) => return Err(ConfigError::Read(error)),
};
```

The `?` operator is not exception handling in disguise. It does not jump to an invisible global handler. It returns from the current function, and the function's return type must allow that error to be returned.

That is why this works when the surrounding function returns a compatible `Result`:

```rust
fn load_text(path: &str) -> Result<String, std::io::Error> {
    let text = std::fs::read_to_string(path)?;
    Ok(text)
}
```

The compiler checks the flow. If your function returns `String`, you cannot use `?` on an I/O result and pretend the error vanished.

:::expand[? returns from this function]{kind="design"}
The most important thing about `?` is where it returns from.

This function:

```rust
fn load_text(path: &str) -> Result<String, std::io::Error> {
    let text = std::fs::read_to_string(path)?;
    Ok(text)
}
```

behaves like this longer version:

```rust
fn load_text(path: &str) -> Result<String, std::io::Error> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) => return Err(error),
    };

    Ok(text)
}
```

The `return Err(error)` returns from `load_text`, not from the whole program. The caller still decides what to do with that `Err`.

That makes `?` different from a panic. A panic says the current path cannot continue normally. `?` says this function cannot produce its success value, so it is handing the error back to its caller.

Use this reading habit:

| You see | Read it as |
| --- | --- |
| `some_result?` | Continue with the `Ok` value or return the `Err` |
| `some_option?` | Continue with the `Some` value or return `None` from an `Option`-returning function |
| `unwrap()` | Continue with the value or panic |

`?` is a readability tool for honest return types. It does not make errors disappear. It makes the early return path small enough that you are willing to keep it in the type.
:::

## Error Boundaries

Most Rust programs have layers. Low-level functions deal with specific errors. Higher-level functions decide how much detail to expose.

For the notes program, keep text searching separate from file loading:

```rust
fn find_default(text: &str) -> Option<&str> {
    text.lines()
        .find(|line| line.starts_with("default="))
        .map(|line| line.trim_start_matches("default="))
}
```

`find_default` returns `Option<&str>` because it only searches text. Missing is a normal search result.

`load_default_notebook` returns `Result<String, ConfigError>` because it crosses a fallible boundary. It reads a file and turns the config into a value the rest of the program needs.

```text
file path
  |
  v
read file              Result<String, io::Error>
  |
  v
search loaded text     Option<&str>
  |
  v
public config API      Result<String, ConfigError>
```

That boundary keeps the caller from needing to know every internal step. The caller can handle a small domain error:

```rust
match load_default_notebook("notes.conf") {
    Ok(name) => println!("Opening {name}"),
    Err(ConfigError::MissingDefault) => println!("Choose a notebook first"),
    Err(ConfigError::Read(error)) => eprintln!("Could not read config: {error}"),
}
```

The practical gotcha is losing information too early. If `load_default_notebook` returned `Result<String, String>`, it would be easy to print a message but harder for another caller to react differently to missing config versus an I/O failure. Keep structured errors inside the program. Turn them into human text at the edge, where you print, log, or send a response.

:::expand[Convert errors at boundaries]{kind="pattern"}
An error boundary is the place where one layer's details become another layer's language.

Inside the config loader, `std::fs::read_to_string` returns `io::Error`. That is the right low-level error. It can say whether the file was missing, permission was denied, or another I/O problem happened.

The rest of the notes app probably does not want every helper to expose raw I/O errors. It wants a config-shaped error:

```rust
enum ConfigError {
    Read(std::io::Error),
    MissingDefault,
}
```

The conversion happens here:

```rust
let text = std::fs::read_to_string(path)
    .map_err(ConfigError::Read)?;
```

`map_err` keeps the original I/O error but wraps it in the domain error. The caller can still tell the difference:

```rust
match error {
    ConfigError::MissingDefault => println!("run setup first"),
    ConfigError::Read(source) => eprintln!("config file problem: {source}"),
}
```

This pattern becomes more valuable as programs grow:

| Boundary | Error language |
| --- | --- |
| Standard library file read | `io::Error` |
| Config loader | `ConfigError` |
| Command-line UI | Human message and exit code |
| HTTP API | Status code and response body |

A string is fine at the final edge. Inside the program, structured errors let different callers make different choices.
:::

## From Option To Result

The search helper returns `Option<&str>` because not finding `default=` is an ordinary search result:

```rust
fn find_default(text: &str) -> Option<&str> {
    text.lines()
        .find(|line| line.starts_with("default="))
        .map(|line| line.trim_start_matches("default="))
}
```

The public loader needs `Result<String, ConfigError>`, so it turns that absence into a domain error:

```rust
find_default(&text)
    .map(str::to_string)
    .ok_or(ConfigError::MissingDefault)
```

Read it in two steps. `map(str::to_string)` changes `Some(&str)` into `Some(String)`. It leaves `None` alone. Then `ok_or(ConfigError::MissingDefault)` changes `Option<String>` into `Result<String, ConfigError>`:

```text
Some(name)    -> Ok(name)
None          -> Err(ConfigError::MissingDefault)
```

That is the pattern: use `Option` while searching, then convert to `Result` at the boundary where the caller needs an explanation.

:::expand[map_err and ok_or are adapters]{kind="pattern"}
Rust has many small adapter methods. They can look cryptic until you connect each one to the longer `match` it replaces.

`map_err` changes only the error side of a `Result`:

```rust
let text = match std::fs::read_to_string(path) {
    Ok(text) => text,
    Err(error) => return Err(ConfigError::Read(error)),
};
```

The compact version is:

```rust
let text = std::fs::read_to_string(path)
    .map_err(ConfigError::Read)?;
```

`ok_or` changes an `Option` into a `Result`:

```rust
let name = match find_default(&text) {
    Some(name) => name.to_string(),
    None => return Err(ConfigError::MissingDefault),
};
```

The compact version is:

```rust
let name = find_default(&text)
    .map(str::to_string)
    .ok_or(ConfigError::MissingDefault)?;
```

Adapters are useful when they preserve the story: read, convert the error shape, continue. If the chain becomes hard to read, a `match` is still good Rust. Clarity wins over compactness.
:::

## Borrow Or Own Inputs

Error flow and ownership meet at API boundaries. A function signature should say whether the function needs to keep data or only read it.

The config search function only reads text, so it borrows:

```rust
fn find_default(text: &str) -> Option<&str> {
    text.lines()
        .find(|line| line.starts_with("default="))
        .map(|line| line.trim_start_matches("default="))
}
```

This is efficient, but it also affects the return type. The returned `&str` points into `text`, so it cannot outlive the loaded config string.

The loader returns an owned `String`:

```rust
fn load_default_notebook(path: &str) -> Result<String, ConfigError> {
    let text = std::fs::read_to_string(path)
        .map_err(ConfigError::Read)?;

    find_default(&text)
        .map(str::to_string)
        .ok_or(ConfigError::MissingDefault)
}
```

That `String` is a deliberate ownership boundary. The loaded file text is local to the function and will be dropped when the function returns. Returning `&str` from inside it would point to data that no longer exists. Rust rejects that shape, and it is right to do so.

Use this rule of thumb:

| Function job | Input shape | Return shape |
| --- | --- | --- |
| Inspect caller-owned text | Borrow with `&str` or `&[T]` | Borrowed result if it points into the input |
| Load data from the outside world | Borrow the path | Owned data, usually `String`, `Vec<T>`, or a domain struct |
| Store data in a struct | Own it unless borrowing is a deliberate design | Owned fields for beginner app code |

:::expand[Borrow inside, own across the boundary]{kind="pattern"}
The common beginner surprise is that this return type cannot work:

```rust
fn load_default_notebook(path: &str) -> Result<&str, ConfigError> {
    let text = std::fs::read_to_string(path)
        .map_err(ConfigError::Read)?;

    find_default(&text).ok_or(ConfigError::MissingDefault)
}
```

The returned `&str` would point into `text`. But `text` is a local `String`. When `load_default_notebook` returns, `text` goes out of scope and Rust drops it. The heap bytes that held the config file are cleaned up. A returned slice would point at data that no longer belongs to the program.

The fix is not to fight lifetimes. The fix is to choose the right ownership boundary:

```rust
fn load_default_notebook(path: &str) -> Result<String, ConfigError> {
    let text = std::fs::read_to_string(path)
        .map_err(ConfigError::Read)?;

    find_default(&text)
        .map(str::to_string)
        .ok_or(ConfigError::MissingDefault)
}
```

Inside the function, borrowing is perfect. `find_default` can cheaply return a slice into `text`. At the public boundary, the function returns an owned `String` so the caller has a value that remains valid after the loader's local variables are gone.

This is the same pattern you saw with application structs: own at boundaries, borrow inside helpers.
:::

## Small Flexible APIs

Rust APIs often accept borrowed inputs because callers should not have to allocate just to call a function.

For paths, a common shape is `impl AsRef<Path>`:

```rust
use std::path::Path;

fn load_default_notebook(path: impl AsRef<Path>) -> Result<String, ConfigError> {
    let text = std::fs::read_to_string(path)
        .map_err(ConfigError::Read)?;

    find_default(&text)
        .map(str::to_string)
        .ok_or(ConfigError::MissingDefault)
}
```

`Path` is Rust's standard borrowed view of a filesystem path. `PathBuf` is the owned, growable path buffer. `AsRef<Path>` is a trait for values that can cheaply present themselves as a `Path`. The `impl AsRef<Path>` parameter means "accept any one value that can be viewed as a path."

This lets callers pass a `&str`, a `String`, a `&Path`, or a `PathBuf` without the loader caring which one they have.

Do not turn every beginner function into a generic API. The private helper below is clearer as `&str`:

```rust
fn find_default(text: &str) -> Option<&str> {
    text.lines()
        .find(|line| line.starts_with("default="))
        .map(|line| line.trim_start_matches("default="))
}
```

Use the flexible shape where the boundary benefits from it. Keep inner helpers plain until real callers need more.

:::expand[AsRef<Path> is public API polish]{kind="design"}
`impl AsRef<Path>` is useful at public boundaries because callers often hold paths in different forms.

Without it, you might force callers to allocate:

```rust
fn load_default_notebook(path: String) -> Result<String, ConfigError> {
    // ...
}
```

That is awkward for a caller that already has a `&str` literal or a `PathBuf`. A borrowed path is often enough:

```rust
fn load_default_notebook(path: impl AsRef<Path>) -> Result<String, ConfigError> {
    let path = path.as_ref();
    let text = std::fs::read_to_string(path)
        .map_err(ConfigError::Read)?;

    find_default(&text)
        .map(str::to_string)
        .ok_or(ConfigError::MissingDefault)
}
```

The function still does one job: load a default notebook. The flexible parameter only removes friction at the edge.

Do not use this shape everywhere on day one. Private helpers are often clearer with concrete types such as `&str` or `&[Note]`. Reach for `impl AsRef<Path>` when the function is a boundary that many callers will use.
:::

## Putting It All Together

The finished loader keeps each uncertainty in the right shape:

```rust
use std::io;
use std::path::Path;

#[derive(Debug)]
enum ConfigError {
    Read(io::Error),
    MissingDefault,
}

fn find_default(text: &str) -> Option<&str> {
    text.lines()
        .find(|line| line.starts_with("default="))
        .map(|line| line.trim_start_matches("default="))
}

fn load_default_notebook(path: impl AsRef<Path>) -> Result<String, ConfigError> {
    let text = std::fs::read_to_string(path)
        .map_err(ConfigError::Read)?;

    find_default(&text)
        .map(str::to_string)
        .ok_or(ConfigError::MissingDefault)
}
```

The file read uses `Result` because I/O can fail. The text search uses `Option` because a missing line is a normal search outcome. The public loader converts both into one domain result, returning an owned `String` because the loaded file text disappears when the function returns.

Count back to the first `unwrap` version:

- The read failure is no longer a panic. It is `Err(ConfigError::Read(error))`.
- The missing default is no longer a panic. It is `Err(ConfigError::MissingDefault)`.
- The success path is still simple. It returns `Ok(name)`.

This is the Rust style beginning to show: the function signature tells the truth, and the code stays small enough to read.

## Toward Idiomatic Rust

You now have the core reliability loop: ownership decides who keeps data alive, borrowing lets helpers inspect without taking over, `Option` represents ordinary absence, and `Result` represents fallible work.

The next module moves from mechanics into idiom. It will use traits, generics, iterators, and standard-library patterns to make Rust code feel less like translated code from another language and more like Rust.

---

**References**

- [Result - Rust standard library](https://doc.rust-lang.org/std/result/)
- [Option - Rust standard library](https://doc.rust-lang.org/std/option/)
- [Recoverable Errors with Result - The Rust Programming Language](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html)
- [Defining an Enum - The Rust Programming Language](https://doc.rust-lang.org/book/ch06-01-defining-an-enum.html)
- [AsRef - Rust standard library](https://doc.rust-lang.org/std/convert/trait.AsRef.html)
