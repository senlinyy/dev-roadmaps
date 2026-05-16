---
title: "Macros"
description: "Use macro_rules and procedural macros as code-generation tools when functions cannot remove the repetition cleanly."
overview: "Macros generate Rust code at compile time. They are powerful, common in the ecosystem, and worth understanding before writing many of your own."
tags: ["macros", "macro-rules", "derive", "metaprogramming"]
order: 1
id: article-rust-advanced-rust-macros
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Why Macros Exist](#why-macros-exist)
3. [macro_rules](#macro_rules)
4. [Derive Macros](#derive-macros)
5. [Attribute And Function Macros](#attribute-and-function-macros)
6. [When To Avoid Macros](#when-to-avoid-macros)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Problem

The notes app now has several commands: `add`, `list`, `search`, `export`, and `sync`. Each command needs a test case with the same setup shape.

Functions remove ordinary repetition. But sometimes the repeated thing is not just runtime behavior. It is code structure:

- Several test functions with different names.
- Several trait implementations that follow the same pattern.
- A public API that needs an attribute to generate glue code.

Macros are Rust's code-generation tool for those cases. They write Rust code before the rest of the compiler checks it.

## Why Macros Exist

A function runs at runtime. A macro expands at compile time.

That gives macros powers functions do not have. A macro can accept a variable number of inputs, generate items, or implement traits for a type.

You have already used macros:

```rust
println!("note: {}", title);
vec![1, 2, 3]
#[derive(Debug, Clone)]
```

The exclamation mark marks function-like macros such as `println!` and `vec!`. The `derive` attribute invokes a procedural macro that generates trait implementations.

The tradeoff is readability. Macro definitions are harder to read than functions. Reach for a function first. Reach for a macro when the repeated shape is code structure, not ordinary behavior.

:::expand[Macros are for syntax-shaped repetition]{kind="design"}
A function can remove this repetition:

```rust
fn normalize(title: &str) -> String {
    title.trim().to_lowercase()
}
```

Every caller can pass a different title at runtime.

A function cannot create several named test functions from a compact list. A macro can:

```rust
macro_rules! parser_case {
    ($name:ident, $input:expr, $expected:expr) => {
        #[test]
        fn $name() {
            assert_eq!(parse_title($input), $expected);
        }
    };
}
```

The macro accepts tokens, not normal runtime values. It can use `$name` as a function name because expansion happens before Rust checks the generated code.

That is the key difference: macros operate on Rust syntax. Use them when the repetition lives in the syntax itself.
:::

## macro_rules

`macro_rules!` defines declarative macros by matching patterns.

```rust
macro_rules! parser_case {
    ($name:ident, $input:expr, $expected:expr) => {
        #[test]
        fn $name() {
            assert_eq!(parse_title($input), $expected);
        }
    };
}
```

The macro can create tests:

```rust
parser_case!(finds_title, "# Rust\nbody", Some("Rust"));
parser_case!(missing_title, "plain text", None);
```

The pattern says:

| Fragment | Meaning |
| --- | --- |
| `$name:ident` | Match an identifier |
| `$input:expr` | Match an expression |
| `$expected:expr` | Match an expression |

The generated code is normal Rust after expansion. If the generated test body is wrong, the compiler reports errors against the expanded code.

## Derive Macros

Derive macros generate trait implementations.

```rust
#[derive(Debug, Clone, PartialEq)]
struct Note {
    title: String,
    body: String,
}
```

You have used this style throughout the roadmap. The derive macro saves you from writing repetitive implementations by hand.

Crates often provide derive macros for serialization, error types, command-line parsing, and database mapping.

```rust
#[derive(serde::Serialize, serde::Deserialize)]
struct Config {
    default_notebook: String,
}
```

This is one reason macros are so central in Rust's ecosystem. They let libraries add ergonomic compile-time code generation while still producing ordinary checked Rust code.

## Attribute And Function Macros

Attribute-like macros attach to items:

```rust
#[tokio::main]
async fn main() {
    println!("async runtime started");
}
```

The macro expands the async main function into runtime setup code.

Function-like macros look like function calls with `!`:

```rust
let message = format!("indexed {count} notes");
```

They can accept syntax that would be impossible for a normal function. `format!` checks the format string and arguments at compile time.

For most Rust developers, reading macro use matters more than authoring procedural macros. Writing procedural macros is a specialized skill with its own crates and testing habits.

## When To Avoid Macros

Macros can hide control flow, make error messages harder, and surprise readers.

Avoid a macro when a function, trait, iterator, or test helper is clear enough.

```rust
fn assert_title(input: &str, expected: Option<&str>) {
    assert_eq!(parse_title(input), expected);
}
```

This helper may be better than a macro if test names do not need to be generated.

Use this rule:

| Repetition | Try first |
| --- | --- |
| Runtime behavior | Function |
| Shared behavior | Trait |
| Data transformation | Iterator |
| Code item generation | Macro |
| Trait implementation boilerplate | Derive macro |

## Putting It All Together

The notes parser can use a small macro for repeated test shapes:

```rust
fn parse_title(input: &str) -> Option<&str> {
    input.lines().find_map(|line| line.strip_prefix("# "))
}

macro_rules! parser_case {
    ($name:ident, $input:expr, $expected:expr) => {
        #[test]
        fn $name() {
            assert_eq!(parse_title($input), $expected);
        }
    };
}

parser_case!(finds_title, "# Rust\nbody", Some("Rust"));
parser_case!(missing_title, "plain text", None);
```

Count back to the opener:

- The repetition is test item structure.
- A helper function cannot generate named tests.
- `macro_rules!` can generate the code before compilation.
- The generated code is still checked by Rust.

Macros are powerful because they move work to compile time. Use that power when syntax is the thing you need to abstract.

## What's Next

Macros generate code that remains checked by normal Rust. The next article covers `unsafe`, where Rust lets you take responsibility for a few operations the compiler cannot fully verify.

---

**References**

- [Macros - The Rust Programming Language](https://doc.rust-lang.org/book/ch20-05-macros.html)
- [Macros By Example - Rust Reference](https://doc.rust-lang.org/reference/macros-by-example.html)
- [Procedural Macros - Rust Reference](https://doc.rust-lang.org/reference/procedural-macros.html)
