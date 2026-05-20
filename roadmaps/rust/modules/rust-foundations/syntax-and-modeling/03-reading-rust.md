---
title: "Reading Rust"
description: "Read small Rust programs by understanding main, functions, bindings, mutability, expressions, strings, vectors, borrowing signs, and macros."
overview: "Rust syntax carries a lot of information. This article reads small programs slowly so the basic signs are familiar before ownership, structs, enums, and modules become the center of the story."
tags: ["syntax", "functions", "bindings", "borrowing"]
order: 3
id: article-rust-rust-foundations-reading-rust
---

## Table of Contents

1. [The Main Function](#the-main-function)
2. [Bindings](#bindings)
3. [Functions](#functions)
4. [Expressions](#expressions)
5. [Strings And Vectors](#strings-and-vectors)
6. [Borrowing Signs](#borrowing-signs)
7. [Macros](#macros)
8. [Reading a Small Program](#reading-a-small-program)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Main Function

If you open the project Cargo created in the previous article, the first Rust file is usually `src/main.rs`. It starts small:

```rust
fn main() {
    println!("Hello, world!");
}
```

The word `fn` starts a function definition. The name `main` is special for a binary crate because it is where the executable starts. The empty parentheses mean this function takes no parameters. The braces hold the body of the function.

The body contains one line:

```rust
println!("Hello, world!");
```

`println!` prints text and a newline. The exclamation point means this is a macro call, not an ordinary function call. Macros can expand into code before the compiler finishes checking the program. You do not need to write macros yet, but you do need to recognize calls such as `println!`, `format!`, `vec!`, `assert!`, and `assert_eq!`.

The semicolon at the end of the line says "run this statement for its effect." Printing is an effect. The program does not need the printed line as a value inside Rust; it sends text to standard output.

Running the project prints:

```bash
$ cargo run
   Compiling hello-rust v0.1.0 (/home/you/hello-rust)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.28s
     Running `target/debug/hello-rust`
Hello, world!
```

The first lines are Cargo's build messages. The final line is the program's output. Separating tool output from program output is a useful habit because later compiler messages, test output, and application logs can appear in the same terminal.

## Bindings

Rust uses `let` to bind a name to a value.

```rust
fn main() {
    let language = "Rust";
    let version = 2024;

    println!("{language} edition {version}");
}
```

The binding `language` refers to the text value `"Rust"`. The binding `version` refers to the integer value `2024`. Rust can infer both types here from the values, so you do not have to write them.

The output is:

```text
Rust edition 2024
```

Bindings are immutable by default. That means this code is rejected:

```rust
fn main() {
    let count = 1;
    count = count + 1;
}
```

The compiler complains because `count` was not declared mutable. If a binding needs to change, write `mut`:

```rust
fn main() {
    let mut count = 1;
    count = count + 1;

    println!("{count}");
}
```

The output is:

```text
2
```

The word `mut` belongs to the binding, not to the value forever. It says this name may be assigned a new value while it is in scope. Later, when borrowing enters the picture, Rust will distinguish a mutable binding from a mutable reference. For now, read `let mut count` as "this local name is allowed to change."

You can also write the type explicitly:

```rust
let count: usize = 2;
```

The colon introduces a type annotation. `usize` is Rust's standard type for sizes and counts, such as vector lengths and indexes.

## Functions

Function signatures are one of the best places to start reading Rust. A signature tells you the function name, input types, and return type.

```rust
fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}
```

Read this from left to right:

| Piece | Meaning |
| --- | --- |
| `fn` | A function is being defined. |
| `count_words` | The function name. |
| `text: &str` | One parameter named `text`, with type `&str`. |
| `-> usize` | The function returns a `usize`. |
| `{ ... }` | The function body. |

The type `&str` means a borrowed view of text. You will learn the full borrowing rules later. At this level, it is enough to see that the function can inspect text without taking ownership of a `String`.

The body has no semicolon:

```rust
text.split_whitespace().count()
```

That matters. In Rust, the final expression in a function body becomes the return value when it has no semicolon. `split_whitespace()` creates an iterator over words, and `count()` counts them. The result is the `usize` promised by the signature.

Calling the function looks like this:

```rust
fn main() {
    let body = "Rust rewards careful reading";
    let count = count_words(body);

    println!("{count}");
}
```

The output is:

```text
4
```

The call `count_words(body)` passes the value bound to `body` into the function. Because `body` is already a string slice, no `&` is needed in this exact example.

## Expressions

Rust makes heavy use of expressions. An expression produces a value. A statement does something but does not produce a useful value for the surrounding code.

The difference is easiest to see with `if`:

```rust
fn label_for(count: usize) -> String {
    let label = if count == 1 {
        "word"
    } else {
        "words"
    };

    format!("{count} {label}")
}
```

The `if` expression produces either `"word"` or `"words"`, and that produced value is bound to `label`. Both branches must produce the same type. In this case, both branches produce `&str`.

The final line uses `format!`:

```rust
format!("{count} {label}")
```

`format!` builds a new `String` instead of printing. There is no semicolon because the function returns that `String`.

If you add a semicolon to the final line, the meaning changes:

```rust
format!("{count} {label}");
```

Now the expression has been turned into a statement. The `String` is created and then ignored. The function promised to return `String`, so the compiler rejects the program.

Blocks can also produce values:

```rust
let doubled = {
    let base = 21;
    base * 2
};
```

The block creates `base`, computes `base * 2`, and returns `42` into `doubled`. The local binding `base` exists only inside the block. This is one reason Rust code can keep temporary names close to the calculation that needs them.

## Strings And Vectors

Rust has more than one text type. Beginners usually see `&str` and `String` first.

`&str` is a borrowed view of text. String literals such as `"Rust"` have type `&str`. A `String` is owned, growable text stored on the heap.

```rust
let borrowed: &str = "Rust";
let owned: String = String::from("Cargo");
```

The borrowed string literal is built into the program. The owned `String` can grow, move, and be returned from functions.

Vectors are growable lists. A vector is written as `Vec<T>`, where `T` is the type of each element. The `vec!` macro creates one conveniently:

```rust
let names = vec!["rust", "cargo", "clippy"];
println!("{}", names.len());
```

The output is:

```text
3
```

Here `names` is a `Vec<&str>`, a vector of borrowed string slices. Rust inferred that type from the string literals.

If you need to build a vector step by step, make the binding mutable:

```rust
fn main() {
    let raw_titles = vec![" Rust ", "Cargo", " borrowing "];
    let mut clean_titles = Vec::new();

    for title in &raw_titles {
        clean_titles.push(title.trim().to_lowercase());
    }

    println!("{clean_titles:?}");
}
```

The output is:

```text
["rust", "cargo", "borrowing"]
```

The loop uses `&raw_titles`, which borrows the vector so the loop can inspect its elements. `trim()` returns a borrowed view without leading or trailing whitespace. `to_lowercase()` creates a new owned `String`, and `push` stores that `String` in `clean_titles`.

The `:?` inside the print string asks Rust to use debug formatting. Debug output is meant for developers. It is useful when you want to inspect a vector, struct, or enum while learning.

## Borrowing Signs

Rust code uses a few symbols that are easy to skim past. They matter because they show how data is being used.

The ampersand `&` usually means a reference. A reference lets code borrow a value without taking ownership.

```rust
fn shout(text: &str) {
    println!("{}", text.to_uppercase());
}

fn main() {
    let title = String::from("rust");
    shout(&title);

    println!("{title}");
}
```

The call `shout(&title)` borrows `title` as text. After the call, `main` can still print `title` because `shout` did not become the owner of the `String`.

Mutable references use `&mut`:

```rust
fn add_suffix(text: &mut String) {
    text.push_str("!");
}

fn main() {
    let mut title = String::from("Rust");
    add_suffix(&mut title);

    println!("{title}");
}
```

The output is:

```text
Rust!
```

There are two `mut` markers here. `let mut title` says the local binding may change. `&mut title` says the function receives a mutable reference to the string. Rust checks mutable references carefully because changing shared data is where many bugs begin.

The asterisk `*` appears less often in beginner code, but it means dereference: follow a reference to the value behind it. You will see it more in ownership, borrowing, and smart pointer articles.

For now, use this quick reading table:

| Sign | First reading |
| --- | --- |
| `&value` | Borrow this value by reference. |
| `&mut value` | Borrow this value through a mutable reference. |
| `*reference` | Use the value behind a reference. |
| `-> Type` | This function returns `Type`. |
| `name: Type` | This parameter or binding has type `Type`. |
| `!` after a name | This is a macro call. |

The table is not the full language. It is enough to keep reading without freezing every time a symbol appears.

## Macros

Macros are code generators that run during compilation. They look like function calls with an exclamation point.

The most common beginner macros are:

| Macro | What it does |
| --- | --- |
| `println!` | Prints formatted text and a newline. |
| `format!` | Builds a formatted `String`. |
| `vec!` | Builds a vector. |
| `assert!` | Fails a test or program if a condition is false. |
| `assert_eq!` | Fails if two values are not equal. |

Here is a small test:

```rust
fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

#[test]
fn counts_words() {
    assert_eq!(count_words("hello rust"), 2);
}
```

The attribute `#[test]` marks the function as a test. The macro `assert_eq!` compares the left and right values. If they differ, the test fails and Cargo prints the mismatch.

Macros can accept patterns that ordinary functions cannot, which is why `println!("{count}")` can understand formatting placeholders. You do not need macro-writing skills for Rust Foundations. You only need to recognize when a call is a macro and read the surrounding code normally.

## Reading a Small Program

Now put the pieces together. This program normalizes a list of titles and prints the result:

```rust
fn normalize_title(title: &str) -> String {
    title.trim().to_lowercase()
}

fn main() {
    let raw_titles = vec![" Rust ", "Cargo", " borrowing "];
    let mut clean_titles = Vec::new();

    for title in &raw_titles {
        let clean = normalize_title(title);
        clean_titles.push(clean);
    }

    println!("{clean_titles:?}");
}
```

Start with the function signature. `normalize_title` takes `title: &str`, a borrowed view of text, and returns `String`, an owned text value. The body trims whitespace and lowercases the text. Lowercasing creates a new owned string because the result may need new storage.

Then read `main`. `raw_titles` is a vector of string slices. `clean_titles` starts as an empty vector and becomes mutable because the loop pushes new values into it.

The loop is:

```rust
for title in &raw_titles {
    let clean = normalize_title(title);
    clean_titles.push(clean);
}
```

The `&raw_titles` part borrows the vector for iteration. Each `title` is passed to `normalize_title`, which returns an owned `String`. That returned `String` is pushed into `clean_titles`.

The output is:

```text
["rust", "cargo", "borrowing"]
```

This is the basic reading habit to practice. Start with function signatures. Find the bindings. Notice which names are mutable. Look for the final expression in functions and blocks. Treat `&` as a borrowing sign. Treat `!` as a macro sign. Then read the program as data moving from one value to the next.

## Putting It All Together

Small Rust programs are dense because the syntax carries a lot of information:

- `fn main()` tells you where a binary starts.
- `let` creates a binding, and `let mut` creates a binding that can change.
- Function signatures show input and output types.
- Final expressions return values when they have no semicolon.
- `String`, `&str`, and `Vec<T>` are everyday data shapes.
- `&` and `&mut` show borrowed access.
- Macro calls end in `!`.

The point of this article is not to memorize every rule. The useful beginner skill is to slow down and read the visible signs. Rust code is trying to tell you what values exist, which function receives them, which names can change, and what value comes back.

## What's Next

Now that small Rust code is readable, the next step is choosing better shapes for the data itself. Structs group fields that belong together. Enums model a value that can be in one of several states. `match` makes the program handle those states explicitly.

---

**References**

- [The Rust Programming Language: Variables and Mutability](https://doc.rust-lang.org/book/ch03-01-variables-and-mutability.html) - Official guide to `let`, immutability, and `mut`.
- [The Rust Programming Language: Data Types](https://doc.rust-lang.org/book/ch03-02-data-types.html) - Official guide to Rust's scalar and compound types.
- [The Rust Programming Language: Functions](https://doc.rust-lang.org/book/ch03-03-how-functions-work.html) - Official explanation of functions, parameters, statements, and expressions.
- [The Rust Programming Language: References and Borrowing](https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html) - Official explanation of references and borrowing rules.
- [Rust by Example: Macros](https://doc.rust-lang.org/rust-by-example/macros.html) - Official examples for macro syntax and usage.
