---
title: "Borrowing"
description: "Use references so functions can read or change data without taking ownership, while following Rust's reader and writer rules."
overview: "Borrowing keeps ownership in one place while allowing temporary access somewhere else. This article follows shared references, mutable references, borrow scopes, and dangling-reference checks."
tags: ["borrowing", "references", "mutability"]
order: 2
id: article-rust-ownership-and-reliability-borrowing
---

## Table of Contents

1. [What Is Borrowing?](#what-is-borrowing)
2. [Shared References](#shared-references)
3. [Read The Compiler Output](#read-the-compiler-output)
4. [Function Signatures](#function-signatures)
5. [Mutable References](#mutable-references)
6. [Readers And Writers](#readers-and-writers)
7. [Borrow Scopes](#borrow-scopes)
8. [No Dangling References](#no-dangling-references)
9. [Choosing A Signature](#choosing-a-signature)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## What Is Borrowing?

The previous article showed that a `String` moves when a function takes `String` by value. That is useful when the function needs to keep the string. It is too much when the function only needs to inspect the string for a moment.

Create a small project for the next step:

```bash
$ cargo new note-borrow
    Creating binary (application) `note-borrow` package
$ cd note-borrow
```

Put this program in `src/main.rs`:

```rust
fn word_count(title: String) -> usize {
    title.split_whitespace().count()
}

fn main() {
    let title = String::from("release checklist");

    let count = word_count(title);

    println!("{title}: {count} words");
}
```

The helper only counts words. It does not store the title. It does not change the title. It does not need to clean up the title. The signature still asks for `String`, so the call moves ownership into the helper:

```bash
$ cargo check
    Checking note-borrow v0.1.0 (/home/you/note-borrow)
error[E0382]: borrow of moved value: `title`
  --> src/main.rs:10:15
   |
6  |     let title = String::from("release checklist");
   |         ----- move occurs because `title` has type `String`, which does not implement the `Copy` trait
7  |
8  |     let count = word_count(title);
   |                            ----- value moved here
9  |
10 |     println!("{title}: {count} words");
   |               ^^^^^ value borrowed here after move
```

The error points at the shape of the API. `word_count(title)` moved the value because `word_count` asked for an owned `String`. Borrowing is the Rust tool for this exact case. A function can receive a reference to a value, use that reference while it runs, and leave ownership with the caller.

A reference is a value that points at another value without owning it. Shared references are written with `&`.

## Shared References

Change the helper to accept `&String` and change the call to pass `&title`:

```rust
fn word_count(title: &String) -> usize {
    title.split_whitespace().count()
}

fn main() {
    let title = String::from("release checklist");

    let count = word_count(&title);

    println!("{title}: {count} words");
}
```

Run it:

```bash
$ cargo run
   Compiling note-borrow v0.1.0 (/home/you/note-borrow)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.25s
     Running `target/debug/note-borrow`
release checklist: 2 words
```

The output shows the ownership problem is gone. The helper counted two words, then `main` still printed the original title.

The two `&` markers have related jobs:

```text
fn word_count(title: &String) -> usize
                     ^ receives a reference to a String

let count = word_count(&title);
                       ^ creates a reference to title
```

The flow looks like this:

```text
main owns the String
  |
  +-- creates a shared reference
          |
          v
       word_count reads through the reference
          |
          v
       reference stops being used
  |
  v
main still owns the String
```

The helper can read through the reference because the original `String` is still alive. The helper cannot drop the `String`, because it does not own the `String`.

The actual reference is small. It is closer to a checked pointer than to a copy of the string:

```text
main owns:
title -> String handle -> heap text "release checklist"

word_count receives:
title: &String -------> the String owned by main
```

The borrowed parameter lets `word_count` follow the pointer to read the string's length and bytes. It does not receive the `String` handle as an owner, so it cannot free the heap allocation and cannot keep the reference after the owner is gone. The compiler checks that the reference is only used while the owner remains valid.

Shared references are common because many pieces of code need read-only access at the same time. This program creates two shared references and also uses the owner afterward:

```rust
fn main() {
    let title = String::from("release checklist");

    let first_view = &title;
    let second_view = &title;

    println!("{first_view}");
    println!("{second_view}");
    println!("{title}");
}
```

Run it:

```text
release checklist
release checklist
release checklist
```

All three lines are reads. No code is changing the string while another reference expects to see stable text. Rust allows many shared references for that reason.

## Read The Compiler Output

Borrowing errors become easier once you read the labels in the compiler output. Change the program back to the broken owned version:

```rust
fn word_count(title: String) -> usize {
    title.split_whitespace().count()
}

fn main() {
    let title = String::from("release checklist");

    let count = word_count(title);

    println!("{title}: {count} words");
}
```

The checker says:

```text
8  |     let count = word_count(title);
   |                            ----- value moved here
10 |     println!("{title}: {count} words");
   |               ^^^^^ value borrowed here after move
```

The phrase `value moved here` marks the place where ownership left `main`. The phrase `borrowed here after move` marks the later read. In Rust compiler messages, "borrow" often appears because printing, formatting, method calls, and many operators read through references internally. The important beginner question is still simple: who owns the value at this line?

Changing the function signature from `String` to `&String` changes the answer. Ownership stays in `main`, and the helper receives temporary access.

## Function Signatures

Function signatures tell callers what kind of access a function needs.

Compare these three helpers:

```rust
fn save_title(title: String) {
    println!("saved: {title}");
}

fn word_count(title: &String) -> usize {
    title.split_whitespace().count()
}

fn add_suffix(title: &mut String) {
    title.push_str(" checklist");
}
```

The parameter type is the contract:

| Parameter | Meaning For The Caller | Typical Use |
| --- | --- | --- |
| `String` | The function takes ownership | Store, consume, send, or transform into another owner |
| `&String` | The function reads through a shared reference | Inspect text without taking it |
| `&mut String` | The function gets temporary write access | Change the existing string in place |

For learning, `&String` makes the ownership contrast easy to see. In everyday Rust APIs, a read-only text parameter is usually `&str`, because `&str` accepts both owned strings and string literals. The next article explains that choice in detail.

## Mutable References

Shared references read. Mutable references write. A mutable reference uses `&mut`.

Start with a local change:

```rust
fn main() {
    let mut title = String::from("release");

    title.push_str(" checklist");

    println!("{title}");
}
```

Run it:

```text
release checklist
```

The binding is `let mut title` because the program changes the `String` owned by `title`. Move that change into a helper:

```rust
fn add_suffix(title: &mut String) {
    title.push_str(" checklist");
}

fn main() {
    let mut title = String::from("release");

    add_suffix(&mut title);

    println!("{title}");
}
```

Run it:

```bash
$ cargo run
   Compiling note-borrow v0.1.0 (/home/you/note-borrow)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.23s
     Running `target/debug/note-borrow`
release checklist
```

There are two separate permissions here. `let mut title` says the owner is allowed to mutate the value it owns. `&mut title` says the helper receives temporary write access. The helper does not become the owner. It can change the string while the mutable borrow is active.

## Readers And Writers

Rust's borrowing rule can be stated as a reader and writer rule:

| Active Access | Allowed At The Same Time | Reason |
| --- | --- | --- |
| Many shared references | More shared references | Readers do not change the value |
| One mutable reference | No other access to that value | A writer needs exclusive access |

Try to create two mutable references at once:

```rust
fn main() {
    let mut title = String::from("release");

    let first = &mut title;
    let second = &mut title;

    first.push_str(" checklist");
    second.push_str(" notes");

    println!("{title}");
}
```

Check it:

```bash
$ cargo check
    Checking note-borrow v0.1.0 (/home/you/note-borrow)
error[E0499]: cannot borrow `title` as mutable more than once at a time
 --> src/main.rs:5:18
  |
4 |     let first = &mut title;
  |                 ---------- first mutable borrow occurs here
5 |     let second = &mut title;
  |                  ^^^^^^^^^^ second mutable borrow occurs here
6 |
7 |     first.push_str(" checklist");
  |     ----- first borrow later used here
```

The checker is pointing at overlapping write access. `first` is a mutable reference that will be used on line 7. While that writer is active, Rust will not create `second`.

The same idea blocks reading while a writer is active:

```rust
fn main() {
    let mut title = String::from("release");

    let writer = &mut title;
    let reader = &title;

    writer.push_str(" checklist");
    println!("{reader}");
}
```

```text
error[E0502]: cannot borrow `title` as immutable because it is also borrowed as mutable
```

The word `immutable` means read-only here. Rust rejects the shared read because a mutable writer is still active. That rule prevents code from reading a value while another part of the same program is changing it.

The mechanism is easiest to see with `String`. A shared reference to a string is a view of the current string data. A mutable operation such as `push_str` may write more bytes into the existing allocation. If the allocation has enough spare capacity, the pointer may stay the same and the length changes. If the allocation is full, the string may ask the allocator for a larger buffer, copy the old bytes into the new buffer, free the old buffer, and update its pointer.

That means an active reader could be relying on a pointer and length that a writer is about to change. Rust does not try to guess whether this particular `push_str` will reallocate. The rule is simpler and safer:

```text
shared references active -> no mutable reference
mutable reference active -> no shared or second mutable reference
```

The rule protects both cases: ordinary value changes and deeper changes such as a growable buffer moving to a new heap allocation.

## Borrow Scopes

A borrow lasts until its final use, not always until the end of the surrounding block. This is why the following program works:

```rust
fn main() {
    let mut title = String::from("release");

    let reader = &title;
    println!("{reader}");

    let writer = &mut title;
    writer.push_str(" checklist");

    println!("{title}");
}
```

Run it:

```text
release
release checklist
```

The shared reference `reader` is last used in the first `println!`. After that line, the shared borrow is finished. The mutable borrow through `writer` begins later, so the accesses do not overlap.

This detail matters in real code because small rearrangements can change whether borrows overlap. If a reader is printed, logged, or returned after a writer is created, Rust treats the reader as still active. If the reader has no later uses, Rust can end that borrow earlier.

You can make the boundary visible with a smaller scope:

```rust
fn main() {
    let mut title = String::from("release");

    {
        let reader = &title;
        println!("{reader}");
    }

    let writer = &mut title;
    writer.push_str(" checklist");

    println!("{title}");
}
```

The inner braces are not required in this exact program, but they show the idea. References are temporary access paths. Once the path is no longer used, the owner can be borrowed in another way.

## No Dangling References

A dangling reference points at data that no longer exists. Rust rejects code that would create one.

This function tries to return a reference to a local `String`:

```rust
fn make_title() -> &'static String {
    let title = String::from("release checklist");

    &title
}

fn main() {
    let title = make_title();
    println!("{title}");
}
```

Check it:

```bash
$ cargo check
    Checking note-borrow v0.1.0 (/home/you/note-borrow)
error[E0515]: cannot return reference to local variable `title`
 --> src/main.rs:4:5
  |
4 |     &title
  |     ^^^^^^ returns a reference to data owned by the current function
```

The local `String` is owned by the binding `title` inside `make_title`. When `make_title` returns, that binding leaves scope and the `String` is dropped. A reference returned to the caller would point at memory that has already been cleaned up. Rust catches that at compile time.

The fix is to return an owned value:

```rust
fn make_title() -> String {
    let title = String::from("release checklist");

    title
}

fn main() {
    let title = make_title();
    println!("{title}");
}
```

Now ownership moves from the local binding to the caller. The value is still alive after the function returns because the caller owns it.

## Choosing A Signature

When writing a Rust function, start by deciding what access the function really needs.

| Need | Signature Shape | Example |
| --- | --- | --- |
| Keep the value after the call | `String` or another owned type | `fn store_title(title: String)` |
| Read text during the call | `&str` or `&String` while learning | `fn word_count(title: &str) -> usize` |
| Change the caller's value | `&mut String` | `fn add_suffix(title: &mut String)` |
| Return a new value | owned return type | `fn normalize(title: &str) -> String` |

The signature is part of the documentation. A caller can see whether ownership moves, whether the function only reads, and whether the function may change the caller's value.

This is one reason Rust APIs can feel explicit. The access pattern is written into the function boundary.

## Putting It All Together

The opening program failed because a read-only helper took ownership:

```rust
fn word_count(title: String) -> usize {
    title.split_whitespace().count()
}
```

The corrected shape borrows:

```rust
fn word_count(title: &str) -> usize {
    title.split_whitespace().count()
}

fn main() {
    let title = String::from("release checklist");

    let count = word_count(&title);

    println!("{title}: {count} words");
}
```

Run it:

```text
release checklist: 2 words
```

Ownership stays with `main`. The helper gets a shared reference. The reference is valid during the call and then disappears. The original string remains available afterward.

Borrowing is the everyday tool that makes ownership practical. Without it, every helper would have to take, return, clone, or avoid owned data. With it, functions can state exactly what kind of temporary access they need.

## What's Next

Borrowing explains how functions read and change values without taking ownership. The next article applies that rule to the text and list types you will use constantly: `String`, `&str`, `Vec<T>`, and slices.

---

**References**

- [The Rust Programming Language: References and Borrowing](https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html)
- [The Rust Programming Language: The Slice Type](https://doc.rust-lang.org/book/ch04-03-slices.html)
- [std::string::String](https://doc.rust-lang.org/std/string/struct.String.html)
- [std::primitive::str](https://doc.rust-lang.org/std/primitive.str.html)
