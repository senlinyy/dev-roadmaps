---
title: "Programs, Memory, and Control Flow"
description: "Understand what happens while a Rust program runs, including functions, scopes, branches, loops, and cleanup."
overview: "Rust code is easier to read when you know how a program moves through functions and scopes. This article explains the basic execution model behind ownership and borrowing."
tags: ["programs", "memory", "control-flow", "scope"]
order: 1
id: article-rust-computer-science-for-rust-programs-memory-control-flow
---

## Table of Contents

1. [What Is a Running Program?](#what-is-a-running-program)
2. [main and Process Exit](#main-and-process-exit)
3. [Instructions and State](#instructions-and-state)
4. [Function Calls and Stack Frames](#function-calls-and-stack-frames)
5. [Blocks and Scopes](#blocks-and-scopes)
6. [Branches, Loops, and match](#branches-loops-and-match)
7. [Drop and Cleanup](#drop-and-cleanup)
8. [Compiler Errors as Execution Clues](#compiler-errors-as-execution-clues)

## What Is a Running Program?

If you are coming from web development, you may mostly think about source files, components, routes, and requests. Rust asks you to care about what happens when the source code becomes a running program. That running view matters because ownership, borrowing, and cleanup are all rules about values while the program executes.

When you run a Rust binary, the operating system starts a process. A process is a running program with its own memory, arguments, environment variables, file handles, and exit status. The process begins at the Rust `main` function, runs the code inside it, and eventually exits.

Create a tiny project:

```bash
$ cargo new run-model
     Created binary (application) `run-model` package
$ cd run-model
$ cat src/main.rs
fn main() {
    println!("Hello, world!");
}
```

Run it:

```bash
$ cargo run
   Compiling run-model v0.1.0 (/home/you/run-model)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.33s
     Running `target/debug/run-model`
Hello, world!
```

The terminal output hides a lot of machinery. Cargo compiles the code, starts the binary, the binary enters `main`, `println!` writes to standard output, and the process exits successfully.

## main and Process Exit

The `main` function is the starting point for a binary crate.

```rust
fn main() {
    println!("starting");
    println!("finished");
}
```

The lines run in order:

```text
starting
finished
```

`main` can also return a `Result`. This is common when the program does fallible work such as reading a file:

```rust
use std::fs;

fn main() -> std::io::Result<()> {
    let text = fs::read_to_string("notes.txt")?;
    println!("{text}");
    Ok(())
}
```

The return type `std::io::Result<()>` means the program either finishes successfully with `()` or returns an I/O error. The `?` operator returns early if reading the file fails. The final `Ok(())` means success.

The `()` value is called unit. It is Rust's empty value, similar to a function returning nothing useful.

## Instructions and State

A running program executes instructions and changes state. State means the data the program remembers while it runs.

```rust
fn main() {
    let mut count = 0;
    count += 1;
    count += 1;
    println!("{count}");
}
```

The output is:

```text
2
```

The binding `count` starts at `0`, changes to `1`, changes to `2`, and is printed. Rust requires `mut` because the binding is assigned more than once.

Some values are small and simple:

```rust
let port: u16 = 443;
let enabled: bool = true;
```

Other values own resources:

```rust
let title = String::from("Rust notes");
```

The `String` owns heap memory for its text. This matters later when the program leaves the scope where `title` exists.

## Function Calls and Stack Frames

A function call enters another function and gives it its own local values. The temporary storage for one active function call is called a stack frame.

```rust
fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn main() {
    let body = String::from("Rust checks ownership before code runs");
    let count = count_words(&body);
    println!("{count}");
}
```

When `main` calls `count_words`, the function receives `text`, a borrowed view of the string owned by `body`. The function counts the words and returns a `usize`. After the function returns, its local parameter `text` is gone.

That temporary stack-frame behavior explains this common mistake:

```rust
fn bad_reference() -> &String {
    let title = String::from("Rust");
    &title
}
```

The function tries to return a reference to `title`, but `title` is local to the function. When the function returns, `title` is dropped. The returned reference would point to a value that no longer exists, so Rust rejects the code.

The fix is to return an owned value:

```rust
fn good_value() -> String {
    let title = String::from("Rust");
    title
}
```

Now ownership of the `String` moves back to the caller.

## Blocks and Scopes

A block is code inside braces. A scope is the region where a name is valid.

```rust
fn main() {
    let outer = String::from("outside");

    {
        let inner = String::from("inside");
        println!("{inner}");
    }

    println!("{outer}");
}
```

The output is:

```text
inside
outside
```

The name `inner` exists only inside the inner braces. After that block ends, `inner` cannot be used. The name `outer` exists until the end of `main`.

This version fails:

```rust
fn main() {
    {
        let inner = String::from("inside");
    }

    println!("{inner}");
}
```

Rust reports that `inner` is not found in this scope. That error is literal: the name existed inside the block, and the print line is outside that block.

Scopes are one of the first places where Rust's memory model becomes visible. When an owned value leaves scope, Rust drops it.

## Branches, Loops, and match

Control flow decides which code runs.

An `if` chooses between branches:

```rust
fn label(count: usize) -> &'static str {
    if count == 1 {
        "item"
    } else {
        "items"
    }
}
```

Both branches return a string slice. The whole `if` expression becomes the return value of the function.

A loop repeats work:

```rust
fn main() {
    let names = vec!["Ada", "Grace", "Linus"];

    for name in &names {
        println!("{name}");
    }

    println!("{} names", names.len());
}
```

The `&names` borrow lets the loop read the vector without taking ownership of it. The final line can still use `names`.

`match` chooses a branch by pattern:

```rust
fn describe(value: Option<&str>) -> String {
    match value {
        Some(text) => format!("found {text}"),
        None => String::from("missing"),
    }
}
```

`Some(text)` handles the present case and gives the inner value a name. `None` handles the missing case. Rust checks that the match covers the possible shapes.

## Drop and Cleanup

Rust cleans up owned values when they go out of scope. This cleanup is called drop.

A `String` owns heap memory:

```rust
fn main() {
    let title = String::from("Rust notes");
    println!("{title}");
}
```

At the closing brace of `main`, `title` goes out of scope. Rust drops the `String`, and the string releases its heap allocation.

You can make drop visible by defining a type with a `Drop` implementation:

```rust
struct Tracer(&'static str);

impl Drop for Tracer {
    fn drop(&mut self) {
        println!("dropping {}", self.0);
    }
}

fn main() {
    let outer = Tracer("outer");

    {
        let inner = Tracer("inner");
        println!("inside block");
    }

    println!("leaving main");
}
```

The output is:

```text
inside block
dropping inner
leaving main
dropping outer
```

The inner value is dropped when the inner block ends. The outer value is dropped when `main` ends. Rust uses this same scope-based cleanup for ordinary types such as `String`, `Vec<T>`, files, locks, and sockets.

## Compiler Errors as Execution Clues

Rust compiler errors often describe a problem in the program's execution path.

This code moves a `String`:

```rust
fn main() {
    let title = String::from("Rust notes");
    let saved = title;

    println!("{title}");
    println!("{saved}");
}
```

The assignment `let saved = title;` moves ownership of the string into `saved`. The old name `title` is no longer valid. Rust rejects the later `println!("{title}")`.

A beginner-friendly way to debug this kind of error is to trace the code in order:

1. Where is the value created?
2. Which name owns it?
3. Does a function call or assignment move it?
4. Is later code trying to use an old name?
5. Where does the scope end?

That trace tells you which names are valid at that point in the program and which name currently owns the value.

---

**References**

- [The Rust Programming Language: Functions](https://doc.rust-lang.org/book/ch03-03-how-functions-work.html) - Official explanation of function calls, parameters, statements, and expressions.
- [The Rust Programming Language: Control Flow](https://doc.rust-lang.org/book/ch03-05-control-flow.html) - Official guide to `if`, loops, and expression-based control flow.
- [The Rust Reference: Variables](https://doc.rust-lang.org/reference/variables.html) - Reference documentation for local variables and scopes.
- [The Rust Reference: Destructors](https://doc.rust-lang.org/reference/destructors.html) - Reference documentation for drop scopes and cleanup behavior.
