---
title: "Values, Types, and Bits"
description: "Learn how Rust types give meaning to bits, restrict operations, model states, and make absence or failure visible."
overview: "Computers store bits, but Rust programs work with typed values. This article explains how types make data meaningful and safer to use."
tags: ["types", "bits", "values", "enums"]
order: 3
id: article-rust-computer-science-for-rust-values-types-bits
---

## Table of Contents

1. [What Are Bits?](#what-are-bits)
2. [Values and Types](#values-and-types)
3. [Integer Types](#integer-types)
4. [Booleans and Flags](#booleans-and-flags)
5. [Text and Unicode](#text-and-unicode)
6. [Structs and Field Meaning](#structs-and-field-meaning)
7. [Enums and Valid States](#enums-and-valid-states)
8. [Option and Result](#option-and-result)

## What Are Bits?

A bit is a single `0` or `1`. Computer memory stores data as bits. Eight bits make a byte. Files, strings, images, network packets, numbers, and executable instructions all become bytes at some layer.

The same byte can mean different things depending on how the program reads it. The byte value `65` can be the integer 65. In ASCII text, it can represent the letter `A`. Inside a larger memory address, it may be one small part of a pointer.

Rust does not let most code treat bytes as any meaning it wants. A value has a type, and the type controls what the value means and which operations are allowed.

You can see bytes directly:

```rust
fn main() {
    let text = "A";
    println!("{:?}", text.as_bytes());
}
```

The output is:

```text
[65]
```

The string `"A"` is stored as one UTF-8 byte, and that byte is 65. The program still treats `"A"` as text because its type is `&str`.

## Values and Types

A value is a piece of data your program can use. A type says what kind of value it is.

```rust
let count: u8 = 65;
let letter: char = 'A';
let word: &str = "A";
```

These values are related, but they are not interchangeable. `count` is an unsigned 8-bit integer. `letter` is a Unicode scalar value. `word` is a borrowed string slice.

Rust uses types to catch mistakes early:

```rust
fn add_one(value: u32) -> u32 {
    value + 1
}

fn main() {
    let text = "41";
    println!("{}", add_one(text));
}
```

This fails because `add_one` expects a `u32`, and `text` is `&str`. The program has to parse the text first:

```rust
fn main() {
    let text = "41";
    let number: u32 = text.parse().unwrap();
    println!("{}", add_one(number));
}
```

The output is:

```text
42
```

The `unwrap` call is a shortcut that panics if parsing fails. Production code often handles the `Result` instead.

## Integer Types

Rust integer types name both signedness and size. Signed integers can be negative. Unsigned integers cannot be negative.

| Type | Meaning | Range shape |
| --- | --- | --- |
| `i8` | 8-bit signed integer | Negative and positive |
| `u8` | 8-bit unsigned integer | 0 and positive |
| `i32` | 32-bit signed integer | Common default integer |
| `u64` | 64-bit unsigned integer | Large non-negative values |
| `usize` | Pointer-sized unsigned integer | Indexes and lengths |

`usize` appears often because collection lengths and indexes use it:

```rust
fn main() {
    let names = ["Ada", "Grace", "Linus"];
    let count: usize = names.len();
    println!("{count}");
}
```

The size of `usize` depends on the target platform. On a 64-bit target, it is 64 bits. On a 32-bit target, it is 32 bits. That makes it suitable for addressing memory and indexing collections on that platform.

Exact integer sizes matter when Rust talks to the outside world. A network packet field may be exactly `u16`. A binary file format may require `u32`. A C interface may expect a specific integer type. In those cases, the type is part of the data contract.

## Booleans and Flags

A boolean has two values: `true` and `false`.

```rust
let enabled = true;
let archived = false;
```

Booleans work well for simple yes-or-no facts. They become harder to manage when several booleans describe one state.

```rust
struct NoteFlags {
    is_draft: bool,
    is_published: bool,
    is_archived: bool,
}
```

This struct can represent impossible combinations, such as a note that is both draft and archived. Rust will compile it because each boolean is valid by itself.

An enum is usually a better model:

```rust
enum NoteState {
    Draft,
    Published,
    Archived,
}
```

Now a note has one state from a fixed set of variants.

## Text and Unicode

Rust strings are UTF-8. UTF-8 is a text encoding that stores Unicode text as bytes. Some characters use one byte. Some use more.

```rust
fn main() {
    let a = "a";
    let crab = "🦀";

    println!("a bytes: {}", a.len());
    println!("crab bytes: {}", crab.len());
}
```

The output is:

```text
a bytes: 1
crab bytes: 4
```

The `.len()` method on `str` returns the number of bytes, not the number of user-perceived characters. This is why Rust does not allow simple indexing like `text[0]` for strings. A byte index may land in the middle of a multi-byte character.

Use `.bytes()` when you want bytes:

```rust
for byte in "A".bytes() {
    println!("{byte}");
}
```

Use `.chars()` when you want Unicode scalar values:

```rust
for ch in "Rust".chars() {
    println!("{ch}");
}
```

Text handling is one of the places where Rust's type system avoids a common beginner mistake. A byte, a `char`, a `String`, and a `&str` are related, but they are different types with different meanings.

## Structs and Field Meaning

A struct groups fields into one value:

```rust
struct User {
    id: u64,
    name: String,
    email: String,
}
```

The field names are part of the source-level meaning. `user.email` is clearer than a tuple field such as `user.2`.

Structs can also separate values that have the same raw type but different meanings:

```rust
struct UserId(u64);
struct TeamId(u64);
```

These are tuple structs. Both wrap a `u64`, but Rust treats `UserId` and `TeamId` as different types. This prevents accidentally passing a team ID where a user ID is expected.

```rust
fn load_user(id: UserId) {
    println!("loading user {}", id.0);
}
```

The `.0` field accesses the inner value. In larger code, you may add methods instead of exposing the inner field directly.

## Enums and Valid States

An enum names the possible shapes of a value.

```rust
enum ApiResponse {
    Loading,
    Success(String),
    Error(String),
}
```

This type says the response is loading, successful with a string body, or failed with an error message. The data belongs to the variant where it makes sense.

Use `match` to handle the variants:

```rust
fn render(response: ApiResponse) -> String {
    match response {
        ApiResponse::Loading => String::from("loading"),
        ApiResponse::Success(body) => body,
        ApiResponse::Error(message) => format!("error: {message}"),
    }
}
```

If you later add another variant, the compiler can point to this match and ask you to handle it. That is one of the main benefits of modeling states with enums.

## Option and Result

`Option<T>` and `Result<T, E>` are standard enum types that appear throughout Rust.

`Option<T>` means present or absent:

```rust
fn first_name(names: &[String]) -> Option<&String> {
    names.first()
}
```

`names.first()` returns `Some(&String)` when the vector has an item and `None` when it is empty.

`Result<T, E>` means success or failure:

```rust
fn parse_count(text: &str) -> Result<u32, std::num::ParseIntError> {
    text.parse()
}
```

The caller sees the failure case in the return type:

```rust
fn main() {
    match parse_count("42") {
        Ok(count) => println!("count: {count}"),
        Err(error) => println!("error: {error}"),
    }
}
```

Missing values and failed operations are written directly into the shape of the function, so the caller knows they exist.

---

**References**

- [The Rust Reference: Types](https://doc.rust-lang.org/reference/types.html) - Official reference explaining Rust types and their role in values and operations.
- [The Rust Programming Language: Data Types](https://doc.rust-lang.org/book/ch03-02-data-types.html) - Official beginner explanation of scalar and compound data types.
- [The Rust Programming Language: Enums and Pattern Matching](https://doc.rust-lang.org/book/ch06-00-enums.html) - Official guide to enums, `Option`, and `match`.
- [Rust Standard Library: Option](https://doc.rust-lang.org/std/option/) - Official documentation for `Option<T>`.
- [Rust Standard Library: Result](https://doc.rust-lang.org/std/result/) - Official documentation for `Result<T, E>`.
