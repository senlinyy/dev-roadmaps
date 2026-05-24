---
title: "Bits And Types"
description: "Learn how Rust types give meaning to bits, restrict operations, represent text, shape structs and enums, and make absence or failure visible."
overview: "Computers store bits, but Rust programs work with typed values. This article explains how types make raw storage meaningful before later modules go deeper into ownership, errors, and API design."
tags: ["types", "bits", "values", "enums"]
order: 3
id: article-rust-computer-science-for-rust-values-types-bits
aliases:
  - values-types-and-bits
  - computer-science-for-rust/03-bits-and-types.md
  - computer-science-for-rust/03-values-types-and-bits.md
  - computer-science-for-rust/execution-basics/03-bits-and-types.md
  - roadmaps/rust/modules/computer-science-for-rust/03-values-types-and-bits.md
  - roadmaps/rust/modules/computer-science-for-rust/execution-basics/03-bits-and-types.md
  - child-computer-science-for-rust-03-values-types-and-bits
  - child-execution-basics-03-bits-and-types
---

## Table of Contents

1. [What Are Bits?](#what-are-bits)
2. [Values and Types](#values-and-types)
3. [Integer Types](#integer-types)
4. [Booleans and State](#booleans-and-state)
5. [Text and Unicode](#text-and-unicode)
6. [Structs](#structs)
7. [Enums](#enums)
8. [Option and Result](#option-and-result)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Are Bits?

The previous article explained where values live: stack frames, heap allocations, handles, references, moves, and cleanup. This article asks what those stored bytes mean.

At the lowest level, memory stores bits. A bit is one binary digit, either `0` or `1`. Eight bits make one byte. The byte pattern `01000001` can mean the number `65`, the letter `A`, one byte inside a larger number, or one byte inside UTF-8 text. The bits are the same. The interpretation changes.

Create a small project:

```bash
$ cargo new bits-notes
    Creating binary (application) `bits-notes` package
$ cd bits-notes
```

Put this in `src/main.rs`:

```rust
fn main() {
    let byte: u8 = 65;

    println!("number: {byte}");
    println!("character: {}", byte as char);
    println!("binary: {byte:08b}");
}
```

Run it:

```bash
$ cargo run
   Compiling bits-notes v0.1.0 (/home/you/bits-notes)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.22s
     Running `target/debug/bits-notes`
number: 65
character: A
binary: 01000001
```

The first output line prints the value as an unsigned integer. The type `u8` means "unsigned 8-bit integer", so the value is a whole number from `0` through `255`. The second line uses `as char` to display the value as a character. The third line uses the format specifier `:08b`, which means "print this number in binary, padded to 8 digits."

Here are a few byte patterns:

| Bits | As unsigned number | As ASCII character |
| --- | --- | --- |
| `01000001` | `65` | `A` |
| `00110001` | `49` | `1` |
| `00100000` | `32` | space |

The table is the whole point of this article in miniature. Computers store patterns. Types tell Rust which patterns are valid, what operations are allowed, and how the bits should be read.

## Values and Types

A value is data with a type. In Rust, `42u8` and `42i32` can print the same way, but they are different typed values.

```rust
fn main() {
    let small: u8 = 42;
    let regular: i32 = 42;

    println!("small={small}, regular={regular}");
}
```

Run it:

```bash
$ cargo run
small=42, regular=42
```

The output hides the difference because both values display as `42`. The source code shows the difference. `u8` is unsigned and uses 8 bits. `i32` is signed and uses 32 bits. Signed means the type can represent negative numbers. Unsigned means it starts at zero and represents only non-negative numbers.

Rust often infers a type from context:

```rust
let count = 42;
```

If nothing else constrains the value, Rust usually chooses `i32` for an integer literal. If you pass the value to a function that expects `usize`, Rust can infer `usize`. If the type matters for the reader or for correctness, write it down:

```rust
let count: usize = 42;
```

The colon means "has type". Read the line as: bind the name `count` to the value `42`, and make the type `usize`.

Types affect operations. This program tries to add different integer types:

```rust
fn main() {
    let small: u8 = 10;
    let count: usize = 5;

    println!("{}", small + count);
}
```

Check it:

```text
$ cargo check
    Checking bits-notes v0.1.0 (/home/you/bits-notes)
error[E0308]: mismatched types
 --> src/main.rs:5:28
  |
5 |     println!("{}", small + count);
  |                            ^^^^^ expected `u8`, found `usize`
```

Rust does not silently choose a conversion here. The compiler knows `small` is `u8` and `count` is `usize`, and it asks you to make the conversion explicit. That prevents accidental truncation or surprising platform-dependent behavior.

## Integer Types

Integer types differ by size and signedness. Size decides how many bit patterns exist. Signedness decides whether some of those patterns represent negative numbers.

| Type | Signed? | Size | Common use |
| --- | --- | --- | --- |
| `u8` | No | 8 bits | Raw bytes, small counters, binary data. |
| `i32` | Yes | 32 bits | Default general-purpose integer. |
| `u32` | No | 32 bits | Counts or IDs that cannot be negative. |
| `i64` | Yes | 64 bits | Larger signed values, timestamps, totals. |
| `usize` | No | pointer-sized | Lengths, indexes, collection sizes. |

A `u8` can hold `255`, but it cannot hold `256`:

```rust
fn main() {
    let max: u8 = 255;
    println!("{max}");
}
```

Run it:

```bash
$ cargo run
255
```

Now change the value:

```rust
fn main() {
    let too_large: u8 = 256;
    println!("{too_large}");
}
```

Check it:

```text
$ cargo check
    Checking bits-notes v0.1.0 (/home/you/bits-notes)
error: literal out of range for `u8`
 --> src/main.rs:2:25
  |
2 |     let too_large: u8 = 256;
  |                         ^^^
  |
  = note: the literal `256` does not fit into the type `u8` whose range is `0..=255`
```

The note line gives the exact range. Eight bits provide 256 possible patterns. For `u8`, those patterns represent the values `0` through `255`.

The mechanism is just counting bit patterns. One bit has two possible states: `0` and `1`. Two bits have four patterns: `00`, `01`, `10`, and `11`. Eight bits have 256 patterns. A `u8` uses all of those patterns for non-negative numbers:

```text
00000000 -> 0
00000001 -> 1
00000010 -> 2
...
11111111 -> 255
```

There is no remaining bit pattern for `256`. Rust catches the literal before the program runs because the type annotation says the storage shape is exactly eight bits wide.

Integer overflow is another place where the type matters. Overflow means a calculation goes past the largest or smallest value the type can represent. In debug builds, Rust checks many primitive integer overflows and panics at runtime. When overflow behavior is part of the program's design, use an explicit method:

```rust
fn main() {
    let value: u8 = 255;

    println!("checked: {:?}", value.checked_add(1));
    println!("wrapping: {}", value.wrapping_add(1));
    println!("saturating: {}", value.saturating_add(1));
}
```

Run it:

```text
checked: None
wrapping: 0
saturating: 255
```

Those three lines show three different meanings for the same too-large addition. `checked_add` returns `None` when the result does not fit. `wrapping_add` wraps around to `0`. `saturating_add` stops at the maximum value. The method name makes the intended behavior visible.

Those methods are useful because the hardware-level operation is simple but the program meaning is not. Adding one to `11111111` produces a carry beyond the eight stored bits. `wrapping_add` keeps only the low eight bits, so the result becomes `00000000`. `saturating_add` notices the overflow and keeps the largest valid value instead. `checked_add` refuses to invent an answer and returns `None`.

## Booleans and State

A `bool` has two values: `true` and `false`.

```rust
fn main() {
    let archived = false;

    if archived {
        println!("hidden");
    } else {
        println!("visible");
    }
}
```

Run it:

```bash
$ cargo run
visible
```

A boolean is useful for one yes-or-no fact. It becomes weak when several booleans try to describe one state.

```rust
struct NoteFlags {
    draft: bool,
    published: bool,
    archived: bool,
}

fn main() {
    let flags = NoteFlags {
        draft: true,
        published: true,
        archived: false,
    };

    println!("draft={}, published={}", flags.draft, flags.published);
}
```

The output is:

```text
draft=true, published=true
```

The program compiles, but the state is probably wrong. A note should usually be draft or published, not both at the same time. Three booleans create eight possible combinations:

| `draft` | `published` | `archived` | Likely meaning |
| --- | --- | --- | --- |
| `true` | `false` | `false` | Draft note. |
| `false` | `true` | `false` | Published note. |
| `false` | `false` | `true` | Archived note. |
| `true` | `true` | `false` | Confusing state. |

Types are a way to control which states can exist. If the program means "one status at a time", an enum is a better shape than several independent booleans.

## Text and Unicode

Rust strings are UTF-8. UTF-8 is an encoding for Unicode text. An encoding is a rule for turning characters into bytes and back again.

This matters because different characters can use different numbers of bytes:

```rust
fn main() {
    let plain = "cafe";
    let accented = "caf\u{e9}";

    println!("plain: {} bytes", plain.len());
    println!("accented: {} bytes", accented.len());
    println!("accented bytes: {:?}", accented.as_bytes());
}
```

Run it:

```text
plain: 4 bytes
accented: 5 bytes
accented bytes: [99, 97, 102, 195, 169]
```

The word `cafe` uses four ASCII letters, one byte each. The escaped string `caf\u{e9}` displays as the same four-letter word with an acute accent over the final letter, but it uses five bytes because Unicode code point `U+00E9` is encoded as two UTF-8 bytes: `195` and `169`.

That is why this string slice is valid:

```rust
let part = &"caf\u{e9}"[0..3];
```

It selects the bytes for `caf`. This slice is invalid and will panic at runtime:

```rust
let broken = &"caf\u{e9}"[0..4];
```

Byte index `4` lands in the middle of the two-byte `U+00E9` character. Rust strings require valid UTF-8, so a string slice must start and end at character boundaries.

The practical rule is simple: `.len()` on `str` and `String` reports bytes, not user-visible characters. Byte length is exactly what low-level storage and networking often need. Human text operations may need `.chars()` or a Unicode-aware crate, depending on the job.

## Structs

A struct groups named fields into one value. The field names give meaning to values that might otherwise be easy to mix up.

```rust
struct Note {
    id: u32,
    title: String,
    archived: bool,
}

fn main() {
    let note = Note {
        id: 7,
        title: String::from("Deploy notes"),
        archived: false,
    };

    println!("{}: {} archived={}", note.id, note.title, note.archived);
}
```

Run it:

```text
7: Deploy notes archived=false
```

The fields make the value readable. The `id` is a `u32`. The `title` is an owned `String`. The `archived` flag is a `bool`. Without field names, three adjacent values could be easy to confuse.

Structs also let functions ask for the whole concept:

```rust
fn print_note(note: &Note) {
    println!("{}: {}", note.id, note.title);
}
```

The parameter `&Note` means the function borrows a note. It does not need separate parameters for every field, and it does not take ownership of the note.

## Enums

An enum defines a value that can be one of several named variants. Variants can carry data.

Use an enum for the note status:

```rust
enum NoteStatus {
    Draft,
    Published { url: String },
    Archived,
}

struct Note {
    title: String,
    status: NoteStatus,
}

fn main() {
    let note = Note {
        title: String::from("Deploy notes"),
        status: NoteStatus::Published {
            url: String::from("/notes/deploy"),
        },
    };

    match note.status {
        NoteStatus::Draft => println!("draft: {}", note.title),
        NoteStatus::Published { url } => println!("published at {url}"),
        NoteStatus::Archived => println!("archived"),
    }
}
```

Run it:

```text
published at /notes/deploy
```

The enum prevents the confusing boolean combination from the earlier section. A note has one `NoteStatus`. If it is published, it carries a URL. If it is draft or archived, it does not carry a URL. The type describes the valid states directly.

Mechanically, an enum value stores which variant it currently is and any data carried by that variant. You can think of the stored value like this:

```text
NoteStatus::Draft
  variant tag: Draft
  payload: none

NoteStatus::Published { url: "/notes/deploy" }
  variant tag: Published
  payload: String handle for the URL

NoteStatus::Archived
  variant tag: Archived
  payload: none
```

Rust's exact memory layout is allowed to be more optimized than this picture, but the behavior is the same for reading code: there is one active variant, and only that variant's payload is available. The `Published` branch can bind `url` because that variant carries a URL. The `Draft` and `Archived` branches cannot accidentally read a URL field because those variants do not have one.

The `match` expression handles every variant. If you add a new variant later, Rust can tell you where your code has not handled it yet. That is one of the most useful parts of modeling state with enums.

## Option and Result

Two standard enums appear constantly in Rust: `Option<T>` and `Result<T, E>`.

`Option<T>` represents a value that may be present or absent:

```rust
fn find_note_title(id: u32) -> Option<&'static str> {
    if id == 1 {
        Some("Deploy notes")
    } else {
        None
    }
}

fn main() {
    match find_note_title(2) {
        Some(title) => println!("found: {title}"),
        None => println!("missing note"),
    }
}
```

Run it:

```text
missing note
```

There is no hidden null pointer here. The type says the title might be absent, and the `match` handles both cases.

`Result<T, E>` represents success or failure:

```rust
use std::fs;

fn main() {
    let result = fs::read_to_string("notes.txt");

    match result {
        Ok(text) => println!("{} bytes", text.len()),
        Err(error) => println!("could not read file: {error}"),
    }
}
```

If the file is missing, the output is:

```text
could not read file: No such file or directory (os error 2)
```

`Ok(text)` carries the successful file contents. `Err(error)` carries the reason reading failed. This is the same typed-state idea from `NoteStatus`, applied to common program situations: missing values and fallible work.

## Putting It All Together

This article started with one byte, `01000001`, and showed that the same stored pattern can mean different things. Rust types make those meanings explicit:

- Integer types decide size, signedness, valid ranges, and overflow choices.
- `bool` works for one yes-or-no fact, while enums model one state chosen from several named states.
- UTF-8 strings store text as bytes, so byte length and character boundaries matter.
- Structs group named fields into one concept.
- Enums describe values with several valid shapes.
- `Option<T>` makes absence visible.
- `Result<T, E>` makes failure visible.

The practical Rust habit is to ask what values are valid before writing much code. A good type narrows the program to states that make sense. The compiler can then reject many impossible or unclear states before the binary ever runs.

## What's Next

The next article moves from individual values to groups of values. You will choose between arrays, slices, vectors, maps, sets, ordered maps, trees, and graph-shaped data by looking at the questions the program needs to answer.

---

**References**

- [The Rust Programming Language: Data Types](https://doc.rust-lang.org/book/ch03-02-data-types.html) - Covers scalar and compound types, including integers, booleans, characters, tuples, and arrays.
- [The Rust Programming Language: Defining and Instantiating Structs](https://doc.rust-lang.org/book/ch05-01-defining-structs.html) - Introduces structs and field syntax.
- [The Rust Programming Language: Enums and Pattern Matching](https://doc.rust-lang.org/book/ch06-00-enums.html) - Explains enums, `Option`, and `match`.
- [std::primitive::str](https://doc.rust-lang.org/std/primitive.str.html) - Documents string slices, UTF-8, length, and slicing behavior.
- [std::result::Result](https://doc.rust-lang.org/std/result/enum.Result.html) - Documents Rust's standard success-or-failure enum.
