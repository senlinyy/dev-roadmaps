---
title: "Strings And Slices"
description: "Choose when Rust code should own text or lists with String and Vec<T>, and when helpers should borrow views with &str and slices."
overview: "String, &str, Vec<T>, and slices make ownership practical in everyday programs. This article follows a notes app that stores owned data and passes borrowed views to helpers."
tags: ["string", "str", "slices", "vec"]
order: 3
id: article-rust-ownership-and-reliability-strings-and-slices
---

## Table of Contents

1. [What Are Strings And Slices?](#what-are-strings-and-slices)
2. [Owned Text](#owned-text)
3. [Borrowed Text](#borrowed-text)
4. [UTF-8 Bytes](#utf-8-bytes)
5. [String Slices](#string-slices)
6. [Vec And List Slices](#vec-and-list-slices)
7. [The Lifetime Of A Slice](#the-lifetime-of-a-slice)
8. [API Choices](#api-choices)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Are Strings And Slices?

The previous article introduced references. A reference lets a function use data without owning it. Text and lists are where that rule becomes part of ordinary Rust code.

You will see these four shapes constantly:

```rust
String
&str
Vec<T>
&[T]
```

They are related, but they do different jobs. A `String` owns growable text. A `&str` borrows a view of UTF-8 text. A `Vec<T>` owns a growable list. A slice such as `&[T]` borrows a view of part or all of a list.

Create a small project:

```bash
$ cargo new note-text
    Creating binary (application) `note-text` package
$ cd note-text
```

Put this program in `src/main.rs`:

```rust
struct Note {
    title: String,
    tags: Vec<String>,
}

fn title_has_word(title: &str, word: &str) -> bool {
    title.split_whitespace().any(|part| part == word)
}

fn print_tags(tags: &[String]) {
    for tag in tags {
        println!("#{tag}");
    }
}

fn main() {
    let note = Note {
        title: String::from("release checklist"),
        tags: vec![String::from("release"), String::from("ops")],
    };

    println!("{}", title_has_word(&note.title, "release"));
    print_tags(&note.tags);
}
```

Run it:

```bash
$ cargo run
   Compiling note-text v0.1.0 (/home/you/note-text)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.29s
     Running `target/debug/note-text`
true
#release
#ops
```

The first output line is `true` because the borrowed title contains the word `release`. The next two lines come from the borrowed tag slice. The important ownership detail is hidden in the function signatures: the `Note` owns the title and tags, while the helper functions borrow views of them.

That split is the practical rule for this article. Store owned data in your application state. Pass borrowed views to helpers that only need to inspect data.

## Owned Text

`String` is Rust's owned, growable text type. Use it when your program needs to store text, build text, or keep text after the current expression finishes.

Start with a single title:

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

The binding is `mut` because the program grows the string. The `String` owns a heap allocation that stores UTF-8 bytes. `push_str` appends more bytes to that owned buffer.

Owned text is also the natural shape for stored application data:

```rust
struct Note {
    title: String,
    body: String,
}

fn new_note(title: String, body: String) -> Note {
    Note { title, body }
}
```

The returned `Note` owns both fields. It can move into a vector, be written to disk, be sent to another function, or live longer than the local variables that created it.

If a struct stores borrowed text, the struct depends on another owner staying alive. That design is sometimes useful, especially for parsers and views, but ordinary application records usually own their fields. Owned fields keep the data and its lifetime in the same place.

## Borrowed Text

`&str` is a borrowed view of UTF-8 text. Use it when a function only needs to read text while it runs.

Change the program to a small word counter:

```rust
fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

fn main() {
    let title = String::from("release checklist");
    let literal = "daily notes";

    println!("{}", word_count(&title));
    println!("{}", word_count(literal));
}
```

Run it:

```bash
$ cargo run
   Compiling note-text v0.1.0 (/home/you/note-text)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.21s
     Running `target/debug/note-text`
2
2
```

The same function accepts both calls. `&title` borrows the whole owned `String` as a string slice. `literal` already has type `&str`, because string literals are borrowed views of text stored in the compiled program.

That flexibility is the main reason many Rust APIs accept `&str` instead of `&String`.

```rust
fn print_title(title: &str) {
    println!("{title}");
}

fn main() {
    let owned = String::from("release checklist");
    let literal = "daily notes";

    print_title(&owned);
    print_title(literal);
    print_title(&owned[0..7]);
}
```

Run it:

```text
release checklist
daily notes
release
```

The helper does not care whether the text came from a `String`, a string literal, or part of a string. It only needs a valid borrowed view during the call.

## UTF-8 Bytes

Rust strings are UTF-8. UTF-8 stores text as bytes, and some characters use more than one byte. This matters because a string index is a byte position, not a character position.

Try to index a string like an array:

```rust
fn main() {
    let title = String::from("notes");

    let first = title[0];

    println!("{first}");
}
```

Check it:

```bash
$ cargo check
    Checking note-text v0.1.0 (/home/you/note-text)
error[E0277]: the type `str` cannot be indexed by `{integer}`
 --> src/main.rs:4:17
  |
4 |     let first = title[0];
  |                 ^^^^^^^^ string indices are ranges of `usize`
```

Rust rejects single-number indexing because the answer would be unclear. Does `title[0]` mean the first byte, the first Unicode scalar value, or the first user-perceived character? Those can differ.

Look at a short UTF-8 example:

```rust
fn main() {
    let plain = "cafe";
    let accented = "caf\u{e9}";

    println!("plain bytes: {}", plain.len());
    println!("accented bytes: {}", accented.len());
    println!("accented chars: {}", accented.chars().count());
}
```

Run it:

```text
plain bytes: 4
accented bytes: 5
accented chars: 4
```

The escaped text `caf\u{e9}` displays as a four-character word with an accent when the program runs, but it uses five bytes because the final character takes two bytes in UTF-8. The `.len()` method reports bytes. The `.chars().count()` call walks Unicode scalar values.

That distinction is why slicing strings requires valid byte boundaries.

## String Slices

A string slice is a borrowed view into UTF-8 text. The type is `&str`.

This slice uses byte range `0..7`:

```rust
fn main() {
    let title = String::from("release checklist");
    let first_word = &title[0..7];

    println!("{first_word}");
}
```

Run it:

```text
release
```

The range starts at byte 0 and ends before byte 7. Because the title is plain ASCII, each visible letter is one byte, so the slice lines up with the word `release`.

Now try a slice that cuts through the two-byte final character in that same word:

```rust
fn main() {
    let word = "caf\u{e9}";
    let broken = &word[0..4];

    println!("{broken}");
}
```

Run it:

```text
thread 'main' panicked at src/main.rs:3:23:
byte index 4 is not a char boundary; it is inside the final character (bytes 3..5)
```

The panic tells you exactly what happened. Byte index 4 lands in the middle of the final character. Rust will not create a `&str` that points at invalid UTF-8. A string slice must start and end at valid character boundaries.

For many application tasks, you avoid manual byte ranges and use string methods instead:

```rust
fn main() {
    let title = "release checklist";

    for word in title.split_whitespace() {
        println!("{word}");
    }
}
```

Output:

```text
release
checklist
```

The method returns valid `&str` slices for each word. You get borrowed views without writing byte indexes yourself.

## Vec And List Slices

`Vec<T>` is Rust's owned, growable list type. Use it when your program needs to store a list whose size can change.

```rust
fn main() {
    let mut tags = Vec::new();

    tags.push(String::from("release"));
    tags.push(String::from("ops"));

    println!("{tags:?}");
}
```

Run it:

```text
["release", "ops"]
```

The vector owns its elements. In this case, each element is an owned `String`. When the vector is dropped, it drops each string and frees the list storage.

A list slice borrows part or all of a vector. Its type is `&[T]`.

```rust
fn print_tags(tags: &[String]) {
    for tag in tags {
        println!("#{tag}");
    }
}

fn main() {
    let tags = vec![
        String::from("release"),
        String::from("ops"),
        String::from("urgent"),
    ];

    print_tags(&tags[0..2]);
    println!("all tags: {}", tags.len());
}
```

Run it:

```text
#release
#ops
all tags: 3
```

The helper received a borrowed view of the first two elements. The vector remained owned by `main`, so `main` could still print its length afterward.

This is the list version of the string pattern:

| Owned Container | Borrowed View | Common Use |
| --- | --- | --- |
| `String` | `&str` | Store text, pass text to readers |
| `Vec<T>` | `&[T]` | Store a list, pass part or all of the list to readers |

The borrowed view stores a pointer and a length. It does not own the elements behind the pointer.

For a list slice such as `&tags[0..2]`, the pointer starts at the first selected element and the length says how many elements are in the view:

```text
Vec<String> owner
+---------+---------+-----------+
| release | ops     | backend   |
+---------+---------+-----------+
  ^
  |
  +-- &[String] pointer, length 2
```

The slice has enough information to iterate over `release` and `ops`, but it has no capacity field and no authority to grow or free the vector. The vector owner still controls the allocation. This is why `&[T]` is a good parameter type for readers: the function receives the exact window it needs, and the caller keeps ownership of the storage.

A string slice works the same way, except the length is measured in bytes and the bytes must form valid UTF-8:

```text
String owner: "release checklist"
               ^
               |
               +-- &str pointer, length 7 bytes
```

That pointer-and-length shape is also why the owner must outlive the slice. If the owner drops or moves its allocation away, the slice would still contain the old pointer and length. Rust rejects that situation before the program runs.

## The Lifetime Of A Slice

A slice can only live while the data it points at is alive.

This program is valid because the slice is used while the original string still exists:

```rust
fn main() {
    let title = String::from("release checklist");
    let first_word = &title[0..7];

    println!("{first_word}");
}
```

This program is rejected because it tries to use a slice after the owned string is gone:

```rust
fn main() {
    let first_word;

    {
        let title = String::from("release checklist");
        first_word = &title[0..7];
    }

    println!("{first_word}");
}
```

Check it:

```text
error[E0597]: `title` does not live long enough
```

The inner binding `title` owns the `String`. At the closing brace, Rust drops that `String`. The slice `first_word` would point into dropped text, so the compiler rejects the program.

This is the same dangling-reference protection from the borrowing article, applied to text slices. A slice is safe because Rust checks that the owner outlives the view.

## API Choices

The most useful beginner heuristic is simple: own data in structs and collections, borrow data in helper parameters.

| Situation | Prefer | Reason |
| --- | --- | --- |
| A `Note` stores a title | `String` | The note owns its own text |
| A helper reads a title | `&str` | The helper does not need ownership |
| A notebook stores many notes | `Vec<Note>` | The notebook owns the list |
| A helper reads notes | `&[Note]` | The helper can inspect a borrowed list |
| A helper builds new text | `String` return value | The caller receives owned output |

Here is that pattern in one small program:

```rust
struct Note {
    title: String,
    tags: Vec<String>,
}

fn has_tag(tags: &[String], wanted: &str) -> bool {
    tags.iter().any(|tag| tag == wanted)
}

fn display_title(title: &str) -> String {
    title.trim().to_uppercase()
}

fn main() {
    let note = Note {
        title: String::from(" release checklist "),
        tags: vec![String::from("release"), String::from("ops")],
    };

    println!("{}", display_title(&note.title));
    println!("{}", has_tag(&note.tags, "ops"));
}
```

Run it:

```text
RELEASE CHECKLIST
true
```

`Note` owns its `String` and `Vec<String>`. `display_title` borrows text and returns a new owned `String` because uppercase conversion creates new text. `has_tag` borrows the tag list and borrows the wanted text. The signatures show which data is stored, which data is inspected, and which data is newly created.

## Putting It All Together

The article opened with four shapes:

```rust
String
&str
Vec<T>
&[T]
```

They now line up with ownership and borrowing:

- `String` owns growable text.
- `&str` borrows a valid UTF-8 view.
- `Vec<T>` owns a growable list.
- `&[T]` borrows a view into a list.

The notes app stores owned values because notes need to keep their titles, bodies, and tags. Helper functions accept borrowed views because they usually inspect data for a short time. Rust checks that every borrowed view points at data that is still alive.

That is the practical bridge from ownership to everyday APIs. Data structures own what they store. Function parameters borrow what they only read.

## What's Next

Strings and slices make ownership visible in text and list APIs. The next article applies the same explicit style to missing data and recoverable failure with `Option` and `Result`.

---

**References**

- [The Rust Programming Language: The Slice Type](https://doc.rust-lang.org/book/ch04-03-slices.html)
- [std::string::String](https://doc.rust-lang.org/std/string/struct.String.html)
- [std::primitive::str](https://doc.rust-lang.org/std/primitive.str.html)
- [std::vec::Vec](https://doc.rust-lang.org/std/vec/struct.Vec.html)
- [std::slice](https://doc.rust-lang.org/std/slice/)
