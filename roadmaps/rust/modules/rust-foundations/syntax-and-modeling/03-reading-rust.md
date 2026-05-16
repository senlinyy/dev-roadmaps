---
title: "Reading Rust"
description: "Read the shape of ordinary Rust code: main, bindings, mutability, expressions, functions, control flow, strings, vectors, and printing."
overview: "Before ownership and borrowing become the main lesson, you need to recognize normal Rust syntax. This article walks through a tiny program and explains the code shapes you will see constantly."
tags: ["syntax", "functions", "control-flow", "strings"]
order: 1
id: article-rust-rust-foundations-reading-rust
---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Main Function](#the-main-function)
3. [Bindings](#bindings)
4. [Expressions](#expressions)
5. [Functions](#functions)
6. [Control Flow](#control-flow)
7. [Strings And Vectors](#strings-and-vectors)
8. [A Small Program](#a-small-program)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

A beginner opens `src/main.rs` and expects Rust to look like a stricter version of a language they already know. Some pieces do feel familiar: functions, variables, strings, loops, and conditionals. Other pieces create friction:

- Variables do not change unless they are marked mutable.
- Some lines end with semicolons and some important lines do not.
- `String` and string literals are not the same thing.
- `println!` has an exclamation mark.
- A loop over a vector already hints at ownership, even before ownership is explained.

This article does not try to teach all of Rust. It teaches how to read the surface of small Rust programs so the next lessons have somewhere to land.

## The Main Function

A binary Rust program starts in `main`:

```rust
fn main() {
    println!("Hello, Rust");
}
```

`fn` defines a function. `main` is the entry point Cargo uses for a binary crate. The braces hold the function body.

`println!` prints a line. The `!` tells you this is a macro call, not an ordinary function call. You do not need to understand macros deeply yet. For now, read `println!` as Rust's common print-line tool.

The string literal `"Hello, Rust"` is text built into the program. Later, the difference between a literal, `&str`, and `String` will matter. At this stage, it is enough to know that string literals are borrowed views of text stored with the program, while `String` is an owned, growable string value.

## Bindings

Rust uses `let` to bind a name to a value:

```rust
fn main() {
    let title = "Rust notes";
    let count = 3;

    println!("{title}: {count}");
}
```

Rust variables are immutable by default. That means this does not compile:

```rust
fn main() {
    let count = 3;
    count = 4;
}
```

If a value should change, say so:

```rust
fn main() {
    let mut count = 3;
    count = count + 1;

    println!("{count}");
}
```

This is one of Rust's early signals. Mutation is allowed, but it is marked. When you read Rust, `mut` is a small warning label: this value changes after it is created.

Rust can often infer types, but you can write them when they clarify intent:

```rust
let count: u32 = 3;
let title: &str = "Rust notes";
```

Do not annotate every type just to prove you can. Add annotations when the compiler needs them or when a reader benefits from seeing the exact shape.

## Expressions

Rust is expression-oriented. An expression produces a value. A statement does some work and does not produce a value you can bind.

This block is an expression because its last line has no semicolon:

```rust
fn main() {
    let score = {
        let base = 10;
        base + 5
    };

    println!("{score}");
}
```

If you add a semicolon after `base + 5`, the block no longer returns that value. This small rule explains many beginner errors. In Rust, the absence of a semicolon can be meaningful.

Functions use the same idea. The last expression can become the return value:

```rust
fn double(value: i32) -> i32 {
    value * 2
}
```

The arrow says the function returns `i32`. The body returns `value * 2` because that expression has no semicolon.

## Functions

Functions name a piece of behavior:

```rust
fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

fn main() {
    let count = word_count("rust makes systems work visible");
    println!("words: {count}");
}
```

The parameter `text: &str` says this function reads a string slice. The return type `usize` is a pointer-sized unsigned integer commonly used for counts and indexes.

The body uses method calls chained together. `split_whitespace()` creates an iterator over words. `count()` consumes that iterator and returns how many items it saw.

You do not need to master iterators yet. Read the chain left to right: split the text into words, then count them.

## Control Flow

Rust has familiar control flow, with a few Rust-shaped details.

An `if` expression can choose a value:

```rust
fn label(count: usize) -> &'static str {
    if count == 0 {
        "empty"
    } else if count == 1 {
        "one word"
    } else {
        "many words"
    }
}
```

Each branch returns the same kind of value. The last expression in each branch has no semicolon because the `if` expression is producing a value.

A `for` loop reads naturally:

```rust
fn main() {
    let words = vec!["rust", "cargo", "compiler"];

    for word in words {
        println!("{word}");
    }
}
```

This example consumes the vector as it loops. Later, ownership will explain exactly what that means. For now, notice the loop shape and the `vec!` macro, which creates a vector with initial values.

## Strings And Vectors

Two types show up constantly in beginner Rust: `String` and `Vec<T>`.

`String` is owned, growable UTF-8 text:

```rust
fn main() {
    let mut note = String::from("learn");
    note.push_str(" Rust");

    println!("{note}");
}
```

`Vec<T>` is a growable list of values of one type:

```rust
fn main() {
    let mut scores = Vec::new();
    scores.push(10);
    scores.push(20);

    println!("{scores:?}");
}
```

The `:?` formatter asks Rust to print a debug representation. Many beginner examples use it because it lets you inspect values while learning.

The angle brackets in `Vec<T>` mean "a vector of T." `Vec<i32>` is a vector of 32-bit integers. `Vec<String>` is a vector of owned strings. You will see this generic type shape everywhere.

## A Small Program

Here is a tiny program that combines the pieces:

```rust
fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn describe(text: &str) -> String {
    let count = count_words(text);

    if count == 0 {
        String::from("No words")
    } else {
        format!("{count} words")
    }
}

fn main() {
    let notes = vec![
        "learn cargo",
        "read compiler errors",
        "",
    ];

    for note in notes {
        println!("{}", describe(note));
    }
}
```

Read it in layers. `main` creates a vector of string literals. The loop passes each note into `describe`. `describe` counts the words and returns an owned `String`. `count_words` borrows text through `&str` and returns a count.

There are ownership details hiding here, especially around `String`, `&str`, and the loop. That is fine. The goal of this article is not to explain all of them yet. The goal is to make the program readable enough that ownership has concrete examples later.

## Putting It All Together

The opening problem was that ordinary Rust syntax can look familiar and strange at the same time. The first reading habits are now in place:

- `fn main` is the binary entry point.
- `let` binds names to values.
- `mut` marks values that can change.
- Missing semicolons often mean an expression is returning a value.
- Functions declare parameter and return types.
- `if`, `for`, and blocks can produce values.
- `String` owns growable text.
- `Vec<T>` stores a growable list of one element type.
- Macros such as `println!`, `format!`, and `vec!` use `!`.

You can now read a small Rust program without understanding every deeper rule. That is enough for the next step: using Rust's data types to model real states more clearly.

## What's Next

The next article focuses on structs, enums, and `match`. These are the tools Rust uses to represent application data and program states before error handling and ownership become the main story.

---

**References**

- [Common Programming Concepts](https://doc.rust-lang.org/stable/book/ch03-00-common-programming-concepts.html). Supports the article's focus on variables, basic types, functions, and control flow.
- [Variables and Mutability](https://doc.rust-lang.org/book/ch03-01-variables-and-mutability.html). Supports immutable-by-default bindings and the role of `mut`.
- [Functions](https://doc.rust-lang.org/book/ch03-03-how-functions-work.html). Supports function syntax and the distinction between statements and expressions.
- [Control Flow](https://doc.rust-lang.org/book/ch03-05-control-flow.html). Supports `if` expressions and loop basics.
- [Storing UTF-8 Encoded Text with Strings](https://doc.rust-lang.org/book/ch08-02-strings.html). Supports `String` as an owned, growable UTF-8 string type.
- [Storing Lists of Values with Vectors](https://doc.rust-lang.org/stable/book/ch08-01-vectors.html). Supports `Vec<T>` as a growable list type.
