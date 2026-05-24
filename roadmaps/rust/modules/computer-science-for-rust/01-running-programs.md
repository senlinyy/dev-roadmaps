---
title: "Running Programs"
description: "Understand what happens while a Rust program starts, calls functions, enters scopes, branches, loops, cleans up values, and exits."
overview: "Rust code is easier to read when you can picture the running program behind it. This article follows a small Cargo project through main, function calls, stack frames, scopes, control flow, cleanup, and compiler feedback."
tags: ["programs", "control-flow", "scope", "stack"]
order: 1
id: article-rust-computer-science-for-rust-programs-memory-control-flow
aliases:
  - programs-memory-and-control-flow
  - computer-science-for-rust/01-running-programs.md
  - computer-science-for-rust/01-programs-memory-and-control-flow.md
  - computer-science-for-rust/execution-basics/01-running-programs.md
  - roadmaps/rust/modules/computer-science-for-rust/01-programs-memory-and-control-flow.md
  - roadmaps/rust/modules/computer-science-for-rust/execution-basics/01-running-programs.md
  - child-computer-science-for-rust-01-programs-memory-and-control-flow
  - child-execution-basics-01-running-programs
---

## Table of Contents

1. [What Is a Running Program?](#what-is-a-running-program)
2. [Cargo, the Binary, and main](#cargo-the-binary-and-main)
3. [Exit Status](#exit-status)
4. [Instructions and State](#instructions-and-state)
5. [Function Calls](#function-calls)
6. [Scopes and Cleanup](#scopes-and-cleanup)
7. [Branches and Loops](#branches-and-loops)
8. [Reading Compiler Output](#reading-compiler-output)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is a Running Program?

Rust Foundations introduced source files, Cargo projects, functions, structs, enums, and modules. Those are the pieces you write. Computer Science for Rust starts with the next question: what happens after the text in `src/main.rs` becomes a running program?

A running program is an operating-system process doing work. The source file is still text on disk. The compiled binary is an executable file under `target/`. The process is the active instance of that binary after the operating system has started it.

That distinction matters because many beginner Rust errors only make sense when you can picture the running program:

- A function call has its own temporary workspace.
- A local binding exists only inside its scope.
- A loop repeats the same instructions with changing state.
- A value may be cleaned up when execution leaves a block.
- A program can print a friendly message but still return a failure status to the shell.

Create a tiny project so the path from file to process is visible:

```bash
$ cargo new run-notes
    Creating binary (application) `run-notes` package
$ cd run-notes
$ cargo run
   Compiling run-notes v0.1.0 (/home/you/run-notes)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.31s
     Running `target/debug/run-notes`
Hello, world!
```

The first command creates a binary package. A binary package builds an executable program. The `cd` command moves your shell into the new project directory. The `cargo run` command does two jobs: it builds the project if needed, then starts the compiled binary.

The line `Compiling run-notes...` comes from Cargo and the Rust compiler. The line `Running target/debug/run-notes` says which executable file Cargo started. The final line, `Hello, world!`, comes from the program itself. That line was printed by Rust code after the process had already started.

The useful picture is:

```text
src/main.rs
    |
    | cargo run asks rustc to compile
    v
target/debug/run-notes
    |
    | operating system starts executable
    v
running process
    |
    | Rust calls your main function
    v
program output
```

The rest of this article follows that running process slowly. The useful goal is to read Rust code as a sequence of active work: enter a function, create a binding, call another function, choose a branch, repeat a loop, leave a scope, clean up, and exit.

## Cargo, the Binary, and main

A normal Rust binary starts in the `main` function you write. Cargo creates this file for a new binary project:

```rust
fn main() {
    println!("Hello, world!");
}
```

The `fn` keyword starts a function definition. The name is `main`. The empty parentheses mean this function takes no arguments. The braces hold the body of the function. The `println!` macro writes one line to standard output, which is the output stream your terminal usually displays.

Run the program again:

```bash
$ cargo run
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.01s
     Running `target/debug/run-notes`
Hello, world!
```

This time Cargo did not need to compile much because the source file had not changed. The `Finished` line still appears because Cargo checked the package and found the existing development build. The program still ran, and the process still printed `Hello, world!`.

Now replace `src/main.rs` with a slightly more useful program:

```rust
fn main() {
    let title = "Deploy notes";
    println!("title: {title}");
}
```

Run it:

```bash
$ cargo run
   Compiling run-notes v0.1.0 (/home/you/run-notes)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.20s
     Running `target/debug/run-notes`
title: Deploy notes
```

The new output proves that the compiled binary includes your updated source. The binding `title` is created while `main` runs. The `println!` line reads the current value of `title` and writes formatted text to standard output.

The phrase "standard output" is worth defining early. A process usually starts with three standard streams:

| Stream | Common name | Usual purpose |
| --- | --- | --- |
| Standard input | stdin | Data the program reads, often from the keyboard or a pipe. |
| Standard output | stdout | Normal program output. |
| Standard error | stderr | Error messages and diagnostics. |

`println!` writes to stdout. Compiler errors and Cargo progress messages usually go to stderr. Your terminal shows both unless you redirect them.

## Exit Status

When a process ends, it returns a small number to the operating system. That number is the exit status. By convention, `0` means success and a non-zero value means failure.

Run the successful program and ask the shell for the previous command's status:

```bash
$ cargo run
title: Deploy notes
$ echo $?
0
```

The `0` was printed by the shell, not by the Rust program. Shell scripts, CI jobs, Makefiles, and deployment tools use this status to decide whether the command succeeded.

A Rust `main` function can return `Result`, which is useful when the program may fail while reading files or doing other fallible work:

```rust
use std::fs;

fn main() -> std::io::Result<()> {
    let contents = fs::read_to_string("notes.txt")?;
    println!("{contents}");
    Ok(())
}
```

The return type `std::io::Result<()>` means the program can end with success or with an I/O error. I/O means input/output work such as reading files, writing files, reading from the terminal, or talking to the network. The `?` after `read_to_string("notes.txt")` means "if this is an error, return that error from this function now."

If the file is missing, a run looks like this:

```bash
$ cargo run
Error: Os { code: 2, kind: NotFound, message: "No such file or directory" }
$ echo $?
1
```

The error line explains what failed. The operating system reported `NotFound` because there was no `notes.txt` file in the current working directory. The shell status is `1`, so automation can treat the command as failed.

This is the first place where Rust's shape is useful. Success and failure are part of the function signature. The program does not need a hidden exception path to report that reading a file failed.

## Instructions and State

A running program changes state step by step. State means the current values the program can see: function parameters, local bindings, heap allocations, open files, and any other resources the process currently owns.

Use a tiny notes example:

```rust
fn main() {
    let title = "Deploy notes";
    let words = count_words(title);

    println!("{words} words in {title}");
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}
```

Run it:

```bash
$ cargo run
2 words in Deploy notes
```

The output is short, but the process took several steps to produce it:

| Step | Program action | State that matters |
| --- | --- | --- |
| 1 | Enter `main` | No local bindings from `main` exist yet. |
| 2 | Run `let title = "Deploy notes";` | `title` now refers to the text `Deploy notes`. |
| 3 | Call `count_words(title)` | Execution moves into `count_words`; `text` receives a borrowed string slice. |
| 4 | Run `split_whitespace().count()` | The words are counted and the result is `2`. |
| 5 | Return from `count_words` | Execution goes back to `main`; `words` receives `2`. |
| 6 | Run `println!` | stdout receives the line `2 words in Deploy notes`. |
| 7 | Leave `main` | Local bindings from `main` stop existing. |

This table is the Rust version of reading command output field by field. You do not need to imagine the whole CPU. Track the current function, the names that are in scope, the values those names refer to, and the next operation.

The type `usize` in `count_words` is the unsigned integer type Rust uses for sizes and indexes. Collection lengths, slice indexes, and counts often use `usize` because its size matches the pointer size of the target platform.

## Function Calls

A function call pauses the caller and enters another function. The called function gets its own parameters and local bindings. When it returns, the caller continues.

Here is a slightly larger program:

```rust
fn line_summary(line: &str) -> String {
    let words = count_words(line);
    format!("{words} words")
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn main() {
    let summary = line_summary("Rust checks code before it runs");
    println!("{summary}");
}
```

Run it:

```bash
$ cargo run
6 words
```

At the busiest moment, the calls are nested like this:

```text
main
+-- line_summary
    +-- count_words
```

`main` calls `line_summary`. `line_summary` calls `count_words`. `count_words` returns the number `6`. Then `line_summary` formats that number into an owned `String` and returns it. Then `main` prints the returned string.

Each active function call has a stack frame. A stack frame is a small workspace for one active function call. It holds the function's parameters, local values that fit directly in the frame, and bookkeeping needed to return to the caller. The next article explains stack and heap memory in more detail. For now, the important point is that active function calls are nested workspaces.

This is why local variable names do not collide across functions:

```rust
fn first() {
    let count = 1;
    println!("first: {count}");
}

fn second() {
    let count = 2;
    println!("second: {count}");
}
```

Both functions can use the name `count` because each call has its own scope. The name in `first` is separate from the name in `second`.

## Scopes and Cleanup

A scope is the region of code where a name is valid. In Rust, braces create scopes. When execution leaves a scope, local bindings from that scope go away.

```rust
fn main() {
    let outer = String::from("outside");

    {
        let inner = String::from("inside");
        println!("{outer}, {inner}");
    }

    println!("{outer}");
}
```

Run it:

```bash
$ cargo run
outside, inside
outside
```

The binding `outer` is created in the body of `main`, so it is available until the end of `main`. The binding `inner` is created inside the nested block, so it is available only until that block's closing brace.

If you try to use `inner` after the block, Rust rejects the program:

```rust
fn main() {
    {
        let inner = String::from("inside");
    }

    println!("{inner}");
}
```

The checker output looks like this:

```text
error[E0425]: cannot find value `inner` in this scope
 --> src/main.rs:6:16
  |
6 |     println!("{inner}");
  |                ^^^^^ not found in this scope
```

Read this output from top to bottom. `error[E0425]` is the compiler's error code and short message. The arrow points at `src/main.rs:6:16`, which means file, line, and column. The caret points at the exact name the compiler could not resolve. The phrase `not found in this scope` is the important diagnosis: the name existed earlier, but it is no longer visible where you tried to use it.

Scopes also control cleanup. A `String` owns heap memory for its text. When the `String` goes out of scope, Rust drops it, which releases that owned memory. You do not call `free` yourself, and Rust does not wait for a garbage collector. Cleanup follows ownership and scope.

In the block example, the cleanup order looks like this:

```text
enter main
  create outer -> heap text "outside"
  enter inner block
    create inner -> heap text "inside"
    print both strings
  leave inner block
    drop inner and free its heap text
  print outer
leave main
  drop outer and free its heap text
```

The name `inner` is unavailable after the nested block because its scope ended. The heap allocation behind `inner` is also gone because the owner was dropped at that same point. That connection between scope, ownership, and cleanup is why Rust can reject use-after-free bugs without waiting until runtime.

## Branches and Loops

Control flow is the order in which a program chooses instructions. An `if` expression chooses one branch. A loop repeats work. Rust keeps these choices explicit.

```rust
fn main() {
    let notes = ["Deploy notes", "Fix login", "Write tests"];

    for title in notes {
        if title.contains("Fix") {
            println!("urgent: {title}");
        } else {
            println!("normal: {title}");
        }
    }
}
```

Run it:

```bash
$ cargo run
normal: Deploy notes
urgent: Fix login
normal: Write tests
```

The `for` loop visits each title. On each visit, the name `title` refers to the current item. The `if` expression checks whether the current title contains the text `Fix`. Only one branch runs for each item.

Here is the same run as a state table:

| Loop pass | `title` | Condition | Printed line |
| --- | --- | --- | --- |
| 1 | `Deploy notes` | `false` | `normal: Deploy notes` |
| 2 | `Fix login` | `true` | `urgent: Fix login` |
| 3 | `Write tests` | `false` | `normal: Write tests` |

Rust also uses `match` when a value has several possible shapes:

```rust
fn main() {
    let maybe_title = Some("Deploy notes");

    match maybe_title {
        Some(title) => println!("found: {title}"),
        None => println!("missing title"),
    }
}
```

The output is:

```text
found: Deploy notes
```

`Some(title)` means there is a title and the branch gives it the local name `title`. `None` means there is no title. Later modules use this pattern heavily because Rust represents absence and failure with ordinary values.

## Reading Compiler Output

Compiler output is part of the Rust development loop. In a beginner language guide, an error message can feel like a wall of text. In Rust, it is often a structured explanation of the program the compiler tried to understand.

Here is a small program with a type mistake:

```rust
fn main() {
    let title = "Deploy notes";
    let words: u8 = count_words(title);

    println!("{words}");
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}
```

Run `cargo check`:

```text
$ cargo check
    Checking run-notes v0.1.0 (/home/you/run-notes)
error[E0308]: mismatched types
 --> src/main.rs:3:21
  |
3 |     let words: u8 = count_words(title);
  |                --   ^^^^^^^^^^^^^^^^^^ expected `u8`, found `usize`
  |                |
  |                expected due to this
```

The command `cargo check` type-checks the project without producing the final executable. It is faster than a full build and useful while editing.

The output says `mismatched types`. The annotation `let words: u8` promised that `words` would be an 8-bit unsigned integer. The function `count_words` returns `usize`. The compiler marks both facts: `expected due to this` points at the annotation, and `expected u8, found usize` points at the expression that produced the other type.

The fix is to let `words` have the returned type:

```rust
fn main() {
    let title = "Deploy notes";
    let words = count_words(title);

    println!("{words}");
}
```

This is a good Rust habit. When compiler output names a type, scope, move, or borrow, read it as a trace of how the compiler followed the running program's shape.

## Putting It All Together

The tiny `run-notes` program started as one line of output, but it exposed the core execution model:

- Cargo compiles source code into a binary and starts that binary as a process.
- `main` is the entry point for the Rust code you write in a normal binary.
- stdout, stderr, and exit status are how the process communicates with the terminal and automation.
- State changes step by step as bindings are created, functions are called, branches are chosen, and loops repeat.
- Each function call has its own active workspace.
- Scopes decide where names are valid and when owned values are cleaned up.
- Compiler output points back to the exact part of the program shape Rust could not accept.

This is the execution layer beneath the Rust syntax you have already seen. You can now read a small Rust program by asking: where does it start, what state exists right now, which function is active, which scope owns each name, and what happens when this block ends?

## What's Next

The next article zooms in on where values live while these steps happen. You will follow simple values, strings, vectors, references, and boxed values through stack and heap memory.

---

**References**

- [The Rust Programming Language: Hello, World!](https://doc.rust-lang.org/book/ch01-02-hello-world.html) - Introduces `main`, compilation, and running a Rust program.
- [The Rust Programming Language: Hello, Cargo!](https://doc.rust-lang.org/book/ch01-03-hello-cargo.html) - Explains Cargo projects, `cargo build`, `cargo run`, and development builds.
- [The Rust Programming Language: Functions](https://doc.rust-lang.org/book/ch03-03-how-functions-work.html) - Covers function definitions, parameters, statements, and expressions.
- [The Rust Programming Language: Control Flow](https://doc.rust-lang.org/book/ch03-05-control-flow.html) - Covers `if`, loops, and branching behavior.
- [std::process::Termination](https://doc.rust-lang.org/std/process/trait.Termination.html) - Documents how return values from `main` become process exit behavior.
