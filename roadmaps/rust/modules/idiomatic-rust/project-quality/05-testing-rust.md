---
title: "Testing Rust"
description: "Use Rust unit tests, integration tests, assertions, and Result-aware checks to protect behavior beyond compilation."
overview: "Rust's compiler prevents many classes of bugs, but it does not know what your program is supposed to do. Tests capture those expectations."
tags: ["testing", "unit-tests", "integration-tests", "assertions"]
order: 1
id: article-rust-idiomatic-rust-testing-rust
---

## Table of Contents

1. [The Problem](#the-problem)
2. [How Cargo Finds Tests](#how-cargo-finds-tests)
3. [Unit Tests](#unit-tests)
4. [Testing Results](#testing-results)
5. [Integration Tests](#integration-tests)
6. [Test Shape](#test-shape)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Problem

Rust can prove that references are valid, moves are legal, and handled errors have the right type. It cannot prove that the notes app parses a title correctly or chooses the right notebook after a config change.

The parser has ordinary product behavior:

- A line starting with `# ` should become a title.
- A file with no title should return `None`.
- Bad config should return the right error.

Those are not type-system questions. They are behavior questions. Rust's built-in test framework gives you a place to record them.

## How Cargo Finds Tests

`cargo test` builds special test targets and looks for functions marked with `#[test]`.

There are two common places to put those tests:

| Test location | What it is good for |
| --- | --- |
| `#[cfg(test)] mod tests` inside a source file | Unit tests near the code, including private helpers |
| Files under `tests/` | Integration tests that use the public library like an outside caller |

This is a compile-time arrangement, not a runtime switch in your application. Cargo asks Rust to build the test version of the crate, and test-only modules are included for that build.

## Unit Tests

Unit tests usually live next to the code they test.

```rust
fn title_from_markdown(input: &str) -> Option<&str> {
    input
        .lines()
        .find_map(|line| line.strip_prefix("# "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_markdown_title() {
        let input = "# Rust Notes\n\nOwnership matters.";

        assert_eq!(title_from_markdown(input), Some("Rust Notes"));
    }
}
```

`#[cfg(test)]` means the module is compiled when tests run. This is closer to a compiler or build flag than a runtime `if`; test-only code is included when Cargo builds the test target. `#[test]` marks a function as a test. `assert_eq!` compares the actual value with the expected value.

Run tests with:

```bash
cargo test
```

Tests are just Rust functions with a special attribute. That is why they can use normal helper functions, normal modules, and the same visibility rules you use in application code.

:::expand[Why unit tests can see private helpers]{kind="design"}
Unit tests often sit in a nested `tests` module inside the same source file:

```rust
fn title_from_markdown(input: &str) -> Option<&str> {
    input.lines().find_map(|line| line.strip_prefix("# "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_title() {
        assert_eq!(title_from_markdown("# Rust"), Some("Rust"));
    }
}
```

The `use super::*` line brings items from the parent module into the test module. Because the test module is still inside the same crate and module tree, it can test private helpers directly.

That is useful for small parsing or formatting functions. But it is also a design signal. If most tests need to reach deep private internals, the public behavior may be hard to exercise, or the code may need a clearer public boundary. Use private unit tests for focused edge cases. Use integration tests for the promises outside callers rely on.
:::

## Testing Results

Rust tests should check both successful and unsuccessful paths.

`Option` makes missing states easy to test:

```rust
#[test]
fn returns_none_when_title_is_missing() {
    let input = "plain text\nwithout heading";

    assert_eq!(title_from_markdown(input), None);
}
```

`Result` is often best checked with pattern matching:

```rust
#[derive(Debug, PartialEq)]
enum ConfigError {
    MissingDefault,
}

fn default_notebook(config: &str) -> Result<&str, ConfigError> {
    config
        .lines()
        .find_map(|line| line.strip_prefix("default="))
        .ok_or(ConfigError::MissingDefault)
}

#[test]
fn reports_missing_default() {
    let result = default_notebook("theme=dark");

    assert_eq!(result, Err(ConfigError::MissingDefault));
}
```

Deriving `PartialEq` for small error enums can make tests simpler. For richer errors, match the variant and inspect only the part that matters.

:::expand[Test the state, not the implementation path]{kind="pattern"}
A good test protects behavior while leaving room to refactor.

This test is fragile:

```rust
#[test]
fn title_parser_uses_lines_iterator() {
    let input = "# Rust\nbody";
    assert_eq!(title_from_markdown(input), Some("Rust"));
}
```

The assertion is fine, but the test name promises an implementation detail. If the parser later uses `split_once`, the behavior is still correct, but the test name is now misleading.

Prefer a behavior name:

```rust
#[test]
fn finds_first_markdown_heading() {
    let input = "# Rust\nbody";
    assert_eq!(title_from_markdown(input), Some("Rust"));
}
```

For `Result`, the same rule applies. Test the observable error state:

```rust
#[test]
fn missing_default_is_reported() {
    let result = default_notebook("theme=dark");
    assert!(matches!(result, Err(ConfigError::MissingDefault)));
}
```

The implementation may use `find_map`, a loop, or a tiny parser later. The test should care that missing default config is reported as the right domain state.
:::

## Integration Tests

Integration tests live in a top-level `tests/` directory in a Cargo project.

```text
my_notes/
  Cargo.toml
  src/
    lib.rs
  tests/
    config_test.rs
```

A test file under `tests/` uses your crate like an outside caller would:

```rust
use my_notes::default_notebook;

#[test]
fn reads_default_notebook_from_config() {
    let config = "default=work\n";

    assert_eq!(default_notebook(config).unwrap(), "work");
}
```

A crate is the library or executable Cargo builds. In an integration test, `use my_notes::default_notebook` imports the public library crate from the same package, just as another project would.

Unit tests are good for small private pieces. Integration tests are good for public behavior across modules.

This is another reason to keep reusable logic in `src/lib.rs` and keep `src/main.rs` thin. Integration tests can import the library crate cleanly.

## Test Shape

A useful Rust test usually has three parts:

1. Set up the input.
2. Run the code.
3. Assert the result.

```rust
#[test]
fn trims_default_notebook_name() {
    let config = "default= work \n";

    let result = default_notebook(config);

    assert_eq!(result, Ok("work"));
}
```

If setup becomes noisy, use helper functions. If a test needs several unrelated assertions, split it. When tests are small, the failing test name becomes useful documentation.

Use `unwrap` carefully in tests. It is often acceptable when reaching the success value is part of the test setup:

```rust
let name = default_notebook("default=work").unwrap();
assert_eq!(name, "work");
```

But when the error path is the behavior under test, match or compare the error directly.

## Putting It All Together

The notes parser can be protected with a small focused test set:

```rust
fn title_from_markdown(input: &str) -> Option<&str> {
    input
        .lines()
        .find_map(|line| line.strip_prefix("# "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_first_markdown_heading() {
        let input = "# Rust Notes\n\nbody";

        assert_eq!(title_from_markdown(input), Some("Rust Notes"));
    }

    #[test]
    fn returns_none_without_heading() {
        let input = "plain text\nwithout heading";

        assert_eq!(title_from_markdown(input), None);
    }
}
```

Count back to the opener:

- Title line behavior is captured.
- Missing title behavior is captured.
- The tests name behavior, not parser internals.

Rust's compiler handles memory and type safety. Tests handle the product promise.

## What's Next

Tests protect behavior. The final article in this module covers the maintenance tools that keep a Rust project pleasant to work in: documentation comments, doctests, formatting, Clippy, and a small command rhythm for review.

---

**References**

- [Writing Automated Tests - The Rust Programming Language](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [How to Write Tests - The Rust Programming Language](https://doc.rust-lang.org/book/ch11-01-writing-tests.html)
- [Test Organization - The Rust Programming Language](https://doc.rust-lang.org/book/ch11-03-test-organization.html)
