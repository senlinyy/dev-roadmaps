---
title: "Ownership"
description: "Understand why Rust moves values, when data is copied or cloned, and how ownership lets Rust clean memory reliably."
overview: "Ownership is the first Rust rule that changes how ordinary code feels. This article follows one note title through creation, movement, copying, cloning, returns, and cleanup."
tags: ["ownership", "moves", "clone", "drop"]
order: 1
id: article-rust-ownership-and-reliability-ownership
---

## Table of Contents

1. [What Is Ownership?](#what-is-ownership)
2. [Create A Value](#create-a-value)
3. [Move A String](#move-a-string)
4. [Why Rust Moves](#why-rust-moves)
5. [Copy Values](#copy-values)
6. [Clone Values](#clone-values)
7. [Function Calls](#function-calls)
8. [Returning Ownership](#returning-ownership)
9. [Drop And Cleanup](#drop-and-cleanup)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## What Is Ownership?

The previous module introduced programs, memory, and values. Rust now adds one rule to every value you create: some part of the program owns that value right now.

Ownership answers three practical questions:

- Which name is allowed to use this value?
- When can responsibility for the value move somewhere else?
- When should Rust clean up the value's resources?

Those questions appear in very small programs. Start with a notes project:

```bash
$ cargo new note-owner
    Creating binary (application) `note-owner` package
$ cd note-owner
```

The project contains a `src/main.rs` file. Put this program in it:

```rust
fn save_title(title: String) {
    println!("saved: {title}");
}

fn main() {
    let title = String::from("release checklist");

    save_title(title);

    println!("done with {title}");
}
```

The program looks ordinary in many languages. The caller creates a title, passes it to a helper, and then wants to print it again. Rust reads the code differently because `String` is an owned value. Check it:

```bash
$ cargo check
    Checking note-owner v0.1.0 (/home/you/note-owner)
error[E0382]: borrow of moved value: `title`
  --> src/main.rs:10:26
   |
6  |     let title = String::from("release checklist");
   |         ----- move occurs because `title` has type `String`, which does not implement the `Copy` trait
7  |
8  |     save_title(title);
   |                ----- value moved here
9  |
10 |     println!("done with {title}");
   |                          ^^^^^ value borrowed here after move
```

Read this output like you would read a Linux command listing. The error code is `E0382`. The short message is `borrow of moved value`. The first marker points at the binding named `title`. The second marker points at the call that moved the value into `save_title`. The final marker points at the later `println!` that tried to use `title` after the move.

Ownership is the rule system behind that message. Passing `title` to a function that accepts `String` gives the function ownership of the string. After that call, the original binding no longer has a usable value.

## Create A Value

Begin with the smallest useful version:

```rust
fn main() {
    let title = String::from("release checklist");

    println!("{title}");
}
```

Run it:

```bash
$ cargo run
   Compiling note-owner v0.1.0 (/home/you/note-owner)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.31s
     Running `target/debug/note-owner`
release checklist
```

The binding is the name `title`. A binding connects a name to a value for a region of code. That region is called a scope. In this program, the scope begins at the `let` line and ends at the closing brace of `main`.

```text
fn main() {
    let title = String::from("release checklist");
    println!("{title}");
}
^ main begins                          ^ main ends
```

The value is a `String`. A `String` owns growable UTF-8 text. The word "owns" matters because the text usually lives in heap memory, and some part of the program must be responsible for freeing that memory later.

Rust ties that responsibility to the owner. When `title` leaves scope, Rust drops the `String`. Dropping means running the cleanup code for the value. For `String`, cleanup releases the heap allocation that stores the text.

This is the first ownership rule in plain language:

| Rule | What It Means In The Program |
| --- | --- |
| Every value has an owner | `title` owns the `String` value |
| The owner has a scope | `title` is valid until the end of `main` |
| Cleanup happens at the end of the scope | Rust drops the `String` when `title` goes out of scope |

There is no garbage collector looking for unused strings later. Rust knows the exact point where the owner stops being valid.

## Move A String

Now assign the same `String` to a second binding:

```rust
fn main() {
    let first = String::from("release checklist");
    let second = first;

    println!("{second}");
}
```

Run it:

```bash
$ cargo run
   Compiling note-owner v0.1.0 (/home/you/note-owner)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.28s
     Running `target/debug/note-owner`
release checklist
```

The program works because `second` is now the owner. The binding `first` gave up ownership when the assignment happened. If you try to print both names, the checker shows the same ownership rule in a smaller form:

```rust
fn main() {
    let first = String::from("release checklist");
    let second = first;

    println!("{first}");
    println!("{second}");
}
```

```bash
$ cargo check
    Checking note-owner v0.1.0 (/home/you/note-owner)
error[E0382]: borrow of moved value: `first`
 --> src/main.rs:5:15
  |
2 |     let first = String::from("release checklist");
  |         ----- move occurs because `first` has type `String`, which does not implement the `Copy` trait
3 |     let second = first;
  |                  ----- value moved here
4 |
5 |     println!("{first}");
  |               ^^^^^^^ value borrowed here after move
```

The important line is `let second = first;`. Rust calls this a move. The ownership of the string moved from `first` to `second`. The original binding remains in the source code, but it no longer owns a usable `String`.

That behavior prevents a serious cleanup problem. A `String` is a small handle on the stack that points to text on the heap:

```text
Stack
+------------------------------+
| first                         |
| pointer ----+                 |
| length: 17  |                 |
| capacity: 17|                 |
+------------|-----------------+
             |
             v
Heap
+------------------------------+
| release checklist            |
+------------------------------+
```

The handle stores a pointer, a length, and a capacity. The pointer says where the heap allocation starts. The length says how many bytes are in use. The capacity says how many bytes the allocation can hold before it must grow.

After `let second = first;`, the heap allocation is still in the same place. The ownership of the handle moved:

```text
Stack
+------------------------------+
| first: no usable value        |
+------------------------------+
| second                        |
| pointer ----+                 |
| length: 17  |                 |
| capacity: 17|                 |
+------------|-----------------+
             |
             v
Heap
+------------------------------+
| release checklist            |
+------------------------------+
```

Rust does not copy the text bytes on the heap for a move. It transfers the right to use and later clean up that allocation.

## Why Rust Moves

If Rust allowed both `first` and `second` to act like full owners, both names would try to clean up the same heap allocation at the end of the scope. That bug is called a double free. It means the program frees memory once, then tries to free the same memory again. In systems programming, double frees can corrupt memory and create security problems.

Rust avoids that entire class of bugs with a simple rule: after a move, the old owner cannot be used.

The rule is easier to see if you compare the two timelines:

| Code | Owner After The Line | What Can Be Used |
| --- | --- | --- |
| `let first = String::from("release checklist");` | `first` | `first` |
| `let second = first;` | `second` | `second` |
| `println!("{first}");` | still `second` | rejected because `first` no longer owns the value |

This is why ownership errors often arrive before you think about memory at all. The compiler is checking who will clean up the resource, even when the program only looks like it is printing text.

## Copy Values

Some values do not move in this visible way. Plain integers are copied:

```rust
fn main() {
    let first = 3;
    let second = first;

    println!("first: {first}");
    println!("second: {second}");
}
```

Run it:

```bash
$ cargo run
   Compiling note-owner v0.1.0 (/home/you/note-owner)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.19s
     Running `target/debug/note-owner`
first: 3
second: 3
```

Both bindings work because `i32` implements the `Copy` trait. A trait is a named capability that a type can have. `Copy` means a value can be duplicated by copying its bits, and the old binding remains usable.

Small fixed-size values commonly implement `Copy`:

| Type Shape | Example | Why Copy Is Fine |
| --- | --- | --- |
| Integers | `i32`, `u64` | The value is the number itself |
| Booleans | `bool` | The value is one small bit pattern |
| Characters | `char` | The value is stored directly |
| Tuples of copy values | `(i32, bool)` | Every field can be copied directly |

`String` does not implement `Copy` because the bits in a `String` are not the text itself. They are a handle to text stored somewhere else.

Conceptually, the handle has three pieces:

```text
String handle on the stack
+-------------------------+
| pointer: 0x...a0        | ----+
| length: 17              |     |
| capacity: 17            |     |
+-------------------------+     |
                                v
heap allocation
+-------------------------+
| release checklist       |
+-------------------------+
```

A bitwise copy would duplicate those three handle fields exactly:

```text
first.pointer  -> 0x...a0
second.pointer -> 0x...a0
```

The text bytes would not be copied. Both handles would point at the same heap allocation, and both handles would look responsible for freeing it when they leave scope. At the end of the scope, `first` would try to drop the allocation and `second` would try to drop the same allocation again. That second cleanup is the double-free problem.

Rust's move rule avoids this by treating `let second = first;` as a transfer. The handle bits can be copied into `second`, but the old binding `first` is no longer usable. There is still only one owner that will run cleanup.

```text
after move:

first   no usable String
second  owns pointer 0x...a0, length 17, capacity 17
```

That is the mechanism behind the compiler phrase "does not implement `Copy`." It is not saying a `String` cannot be copied at all. It is saying the cheap automatic copy would copy only the handle, and that would make cleanup ownership ambiguous. Use `.clone()` when you want a second heap allocation with its own copied text.

## Clone Values

When you really want two independent strings, ask for a clone:

```rust
fn main() {
    let first = String::from("release checklist");
    let second = first.clone();

    println!("first: {first}");
    println!("second: {second}");
}
```

Run it:

```bash
$ cargo run
   Compiling note-owner v0.1.0 (/home/you/note-owner)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.24s
     Running `target/debug/note-owner`
first: release checklist
second: release checklist
```

`clone()` makes a new heap allocation and copies the text into it. After cloning, `first` owns one allocation and `second` owns another allocation.

```text
first  -> heap text "release checklist"
second -> separate heap text "release checklist"
```

That is different from a move. A move is cheap because it transfers the handle. A clone can be more expensive because it may allocate memory and copy bytes. Rust makes that cost visible in the source code. When you see `.clone()`, you know the program asked for another owned copy.

Use this table as a first-pass reading guide:

| Operation | Example | Old Binding Usable? | Heap Text Copied? |
| --- | --- | --- | --- |
| Move | `let second = first;` | No | No |
| Copy | `let second = first_number;` | Yes | No heap text involved |
| Clone | `let second = first.clone();` | Yes | Yes |

## Function Calls

Function parameters follow the same ownership rules as assignments.

This helper takes ownership because its parameter type is `String`:

```rust
fn save_title(title: String) {
    println!("saved: {title}");
}

fn main() {
    let title = String::from("release checklist");

    save_title(title);
}
```

The call `save_title(title)` moves the `String` into the function. Inside `save_title`, the parameter named `title` is the owner. When the function returns, that parameter leaves scope, and Rust drops the string.

You can see the flow as a small ownership trace:

```text
main creates String
  |
  v
title in main owns it
  |
  v
save_title(title) moves it
  |
  v
title parameter in save_title owns it
  |
  v
function ends, parameter is dropped
```

This is why the opening program failed. The caller tried to use a binding after the function had already received ownership.

If the helper needs to store the title, taking ownership is reasonable. If the helper only needs to read it, the next article's borrowing rules are usually the better fit.

## Returning Ownership

A function can also give ownership back to the caller:

```rust
fn normalize_title(title: String) -> String {
    title.trim().to_lowercase()
}

fn main() {
    let raw = String::from("  Release Checklist  ");
    let clean = normalize_title(raw);

    println!("{clean}");
}
```

Run it:

```bash
$ cargo run
   Compiling note-owner v0.1.0 (/home/you/note-owner)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.26s
     Running `target/debug/note-owner`
release checklist
```

The value flow has two moves. First, `raw` moves into `normalize_title`. Then the returned `String` moves into `clean`.

The expression `title.trim().to_lowercase()` builds a new owned `String`. `trim()` creates a borrowed view of the original text without the outer spaces. `to_lowercase()` creates owned lowercase text. That owned result becomes the return value.

If you try to use `raw` after the call, Rust rejects the program for the same reason as before:

```rust
fn main() {
    let raw = String::from("  Release Checklist  ");
    let clean = normalize_title(raw);

    println!("{raw}");
    println!("{clean}");
}
```

```text
error[E0382]: borrow of moved value: `raw`
```

The short error is enough once you know the rule. The binding `raw` moved into the function, so the caller must use the returned owner, `clean`.

## Drop And Cleanup

Rust runs cleanup automatically when an owner leaves scope. The standard library trait behind custom cleanup is called `Drop`.

You can make cleanup visible with a tiny type:

```rust
struct NoteFile {
    name: String,
}

impl Drop for NoteFile {
    fn drop(&mut self) {
        println!("closing {}", self.name);
    }
}

fn main() {
    let file = NoteFile {
        name: String::from("notes.txt"),
    };

    println!("writing {}", file.name);
}
```

Run it:

```bash
$ cargo run
   Compiling note-owner v0.1.0 (/home/you/note-owner)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.22s
     Running `target/debug/note-owner`
writing notes.txt
closing notes.txt
```

The line `writing notes.txt` comes from the explicit `println!` in `main`. The line `closing notes.txt` comes from `drop`, which Rust calls when `file` reaches the end of its scope.

Real standard library types use the same idea. A `String` frees its heap buffer. A `Vec<T>` frees its list storage and drops each element. A file handle closes the underlying file descriptor. The owner does the cleanup at a predictable point.

This predictability is one of Rust's central reliability benefits. Resource cleanup follows the structure of the code instead of depending on a later garbage collection pass or a manual `free` call.

## Putting It All Together

The opening program failed because ownership moved into `save_title`:

```rust
fn save_title(title: String) {
    println!("saved: {title}");
}

fn main() {
    let title = String::from("release checklist");

    save_title(title);

    println!("done with {title}");
}
```

You can now read the failure without treating it as a strange compiler habit:

- `title` owns a `String`.
- `save_title(title)` moves that `String` into the helper.
- The helper's parameter becomes the owner.
- The parameter is dropped when the helper returns.
- The original binding cannot be printed after that move.

If the helper needs to keep or consume the title, taking `String` is honest. If the helper only needs to read the title, taking ownership is more than the helper needs. Rust has a separate tool for that case.

## What's Next

Ownership explains why values move and why old owners become unusable. The next article covers borrowing, which lets a function read or change data for a short time while the original owner keeps responsibility for cleanup.

---

**References**

- [The Rust Programming Language: What Is Ownership?](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html)
- [The Rust Programming Language: References and Borrowing](https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html)
- [std::ops::Drop](https://doc.rust-lang.org/std/ops/trait.Drop.html)
- [std::clone::Clone](https://doc.rust-lang.org/std/clone/trait.Clone.html)
- [std::marker::Copy](https://doc.rust-lang.org/std/marker/trait.Copy.html)
