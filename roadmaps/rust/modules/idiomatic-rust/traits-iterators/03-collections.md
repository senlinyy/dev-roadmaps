---
title: "Collections"
description: "Choose Rust collections such as Vec, HashMap, HashSet, and String based on order, lookup, uniqueness, and ownership."
overview: "Rust programs spend a lot of time moving, borrowing, and transforming groups of values. Collections are where ownership rules become everyday design choices."
tags: ["collections", "vec", "hashmap", "hashset", "string"]
order: 3
id: article-rust-idiomatic-rust-collections
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Rust Collections From JS, TS, And Python](#rust-collections-from-js-ts-and-python)
3. [Vec](#vec)
4. [HashMap](#hashmap)
5. [HashSet](#hashset)
6. [String](#string)
7. [Borrowed Views](#borrowed-views)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

The notes app now has types, traits, and generic helpers. It still needs somewhere to put data.

Different features ask different questions:

- The notebook screen wants notes in order.
- Search wants to find a note by ID quickly.
- Tags should not be duplicated.
- File loading produces owned text that can grow.

One collection cannot be the best answer to every question. Rust's standard library gives you several common containers, and the right choice depends on the access pattern.

## Rust Collections From JS, TS, And Python

The familiar names are a decent starting point, but Rust collections add ownership and stricter element types.

| Familiar idea | Rust starting point | Important difference |
| --- | --- | --- |
| JavaScript `Array` or Python `list` | `Vec<T>` | One element type per vector |
| JavaScript `Map` or Python `dict` | `HashMap<K, V>` | Great for lookup; do not rely on display order |
| JavaScript `Set` or Python `set` | `HashSet<T>` | Great for uniqueness; do not rely on display order |
| JavaScript/Python string | `String` and `&str` | Owned text and borrowed text are different types |

When you put a value into a Rust collection, ownership matters. `notes.push(note)` moves the note into the vector. `notes.get(0)` borrows a note from the vector. The collection is not only a container; it is also an owner.

## Vec

`Vec<T>` is the default collection for an ordered list of values.

```rust
#[derive(Debug)]
struct Note {
    title: String,
    body: String,
}

let mut notes: Vec<Note> = Vec::new();

notes.push(Note {
    title: String::from("Rust"),
    body: String::from("Ownership first."),
});
```

A vector stores a variable number of values of the same type. Unlike a JavaScript array, a `Vec<Note>` cannot also hold a random string or number. It keeps values in order, supports indexing, and grows as needed.

```rust
if let Some(first) = notes.first() {
    println!("{}", first.title);
}
```

Use `first`, `get`, and other safe access methods when the index might be missing. Indexing with `notes[0]` is direct, but it panics if the vector is empty.

The ownership rule is simple: a `Vec<Note>` owns its notes. Passing `&notes` borrows the list. Passing `notes` moves the list.

:::expand[Vec owns the list, not just the pointer]{kind="design"}
A vector has a small value on the stack that points to heap storage. That heap storage holds the elements.

For a `Vec<Note>`, the vector owns the buffer, and the buffer owns each `Note`. Each `Note` owns its `String` fields.

```text
notes
  |
  v
Vec buffer
  |
  +-- Note { title, body }
  +-- Note { title, body }
```

This explains a few everyday behaviors:

| Action | Meaning |
| --- | --- |
| `notes.push(note)` | Move `note` into the vector |
| `for note in &notes` | Borrow each note |
| `for note in notes` | Move each note out and consume the vector |
| `notes.get(0)` | Borrow an item if it exists |

The important habit is to decide whether a function needs ownership of the collection or only a view of it. Most helper functions should take `&[Note]` instead of `&Vec<Note>` because a slice is the borrowed view of a sequence. That lets callers pass a whole vector, part of a vector, or another slice-shaped source.
:::

## HashMap

`HashMap<K, V>` stores values by key.

```rust
use std::collections::HashMap;

let mut notes_by_id: HashMap<u64, Note> = HashMap::new();

notes_by_id.insert(
    1,
    Note {
        title: String::from("Cargo"),
        body: String::from("Cargo owns the project workflow."),
    },
);
```

Use a map when the main question is "what value belongs to this key?"

```rust
if let Some(note) = notes_by_id.get(&1) {
    println!("{}", note.title);
}
```

`get` returns `Option<&V>` because the key might not exist. That connects directly to the previous module: missing lookup is ordinary absence, so it is an `Option`.

Do not treat `HashMap` iteration order as UI order. A map is optimized for keyed lookup, not for preserving the order you inserted items.

The `entry` API is useful when inserting depends on whether the key already exists:

```rust
let count = notes_by_id.entry(2).or_insert(Note {
    title: String::from("New"),
    body: String::new(),
});

count.body.push_str("Created on first access.");
```

The exact value here is less important than the pattern. A map is for keyed ownership and lookup. Use it when the key is the stable way to find the value again.

## HashSet

`HashSet<T>` stores unique values.

```rust
use std::collections::HashSet;

let mut tags = HashSet::new();

tags.insert(String::from("rust"));
tags.insert(String::from("rust"));
tags.insert(String::from("cargo"));

println!("{}", tags.len());
```

The length is `2`, not `3`, because a set keeps one copy of each value.

Use a set when the main question is membership:

```rust
if tags.contains("rust") {
    println!("show Rust notes");
}
```

Sets are not for preserving display order. If the UI needs tags in a stable order, collect and sort them before display, or choose a different structure. The set's job is uniqueness and fast membership checks.

:::expand[Why HashMap and HashSet do not promise display order]{kind="pitfall"}
Hash maps and hash sets are built for fast lookup and membership checks. They organize data using hashes of the keys, not by the order a human would naturally read.

That means this kind of code is a trap:

```rust
for tag in tags {
    println!("{tag}");
}
```

It may print a useful-looking order during one run and a different order later. The code did not ask for sorted or insertion order; it asked a set to reveal its internal traversal order.

For display, create the order explicitly:

```rust
let mut tags: Vec<&String> = tags.iter().collect();
tags.sort();

for tag in tags {
    println!("{tag}");
}
```

Use this rule of thumb:

| Need | Better shape |
| --- | --- |
| Fast lookup by key | `HashMap<K, V>` |
| Fast uniqueness check | `HashSet<T>` |
| Stable display order | `Vec<T>` or collect and sort |
| Both lookup and display order | Keep a map for lookup and a separate ordered list when needed |

Rust's standard hash collections are excellent when you ask their main question. They are a poor source of presentation order.
:::

## String

`String` is an owned, growable UTF-8 text buffer.

```rust
let mut body = String::from("Rust");
body.push_str(" notes");
```

Use `String` when your code owns text or needs to build it. Use `&str` when your code only needs to read text.

```rust
fn title_length(title: &str) -> usize {
    title.len()
}

let title = String::from("Collections");
println!("{}", title_length(&title));
```

This is the same ownership pattern repeated in text form. Application structs often own strings. Helper functions often borrow string slices.

One gotcha: string length is bytes, not user-visible characters.

```rust
let word = "cafe";
println!("{}", word.len());
```

For plain ASCII text, bytes and characters line up. For full Unicode text, they may not. Rust makes strings UTF-8, so text handling is safe, but you still need to choose the right operation for the question you are asking.

## Borrowed Views

Collection APIs become more flexible when helpers borrow views instead of concrete containers.

This works, but it is narrower than needed:

```rust
fn count_notes(notes: &Vec<Note>) -> usize {
    notes.len()
}
```

This is usually better:

```rust
fn count_notes(notes: &[Note]) -> usize {
    notes.len()
}
```

The function only needs a sequence of notes, so a slice says that directly.

The same idea applies to text:

```rust
fn has_tag(line: &str, tag: &str) -> bool {
    line.contains(tag)
}
```

The function does not need ownership of a `String`. It only needs to inspect text.

:::expand[Choose the collection by the question]{kind="pattern"}
Collection choice is easier when you start with the question the code will ask most often.

| Main question | Good starting type |
| --- | --- |
| What is the next item in order? | `Vec<T>` |
| What value has this ID? | `HashMap<K, V>` |
| Have I seen this value before? | `HashSet<T>` |
| Who owns this text buffer? | `String` |
| Can this helper read a sequence? | `&[T]` |
| Can this helper read text? | `&str` |

For the notes app, the notebook screen probably starts with `Vec<Note>` because display order matters. A search index might add `HashMap<NoteId, Note>` or `HashMap<String, Vec<NoteId>>` because lookup matters. Tags might use `HashSet<String>` while editing because uniqueness matters, then convert to a sorted `Vec<String>` for display.

The gotcha is choosing based on habit. If every group becomes a vector, membership checks become awkward. If every group becomes a map, ordered display becomes awkward. Let the access pattern choose the collection.
:::

## Putting It All Together

The notes app can combine collections by job:

```rust
use std::collections::{HashMap, HashSet};

#[derive(Debug)]
struct Note {
    id: u64,
    title: String,
    body: String,
    tags: HashSet<String>,
}

struct Notebook {
    notes: Vec<Note>,
    titles_by_id: HashMap<u64, String>,
}

fn titles(notes: &[Note]) -> Vec<&str> {
    notes.iter().map(|note| note.title.as_str()).collect()
}
```

`Vec<Note>` keeps display order. `HashSet<String>` keeps tags unique. `HashMap<u64, String>` gives keyed lookup. The `titles` helper takes a slice because it only needs to read a sequence.

Count back to the opener:

- Ordered screen: `Vec`.
- Lookup by ID: `HashMap`.
- Unique tags: `HashSet`.
- Owned text: `String`.
- Read-only helper input: slice or `&str`.

The collection choice is part of the design, not a detail to fix later.

## What's Next

Collections hold the data. The next article shows how idiomatic Rust code moves through that data with iterators and closures: borrowing with `iter`, mutating with `iter_mut`, consuming with `into_iter`, and collecting transformed values.

---

**References**

- [Common Collections - The Rust Programming Language](https://doc.rust-lang.org/book/ch08-00-common-collections.html)
- [std::collections - Rust standard library](https://doc.rust-lang.org/std/collections/index.html)
- [Vec - Rust standard library](https://doc.rust-lang.org/std/vec/struct.Vec.html)
- [HashMap - Rust standard library](https://doc.rust-lang.org/std/collections/struct.HashMap.html)
- [HashSet - Rust standard library](https://doc.rust-lang.org/std/collections/struct.HashSet.html)
