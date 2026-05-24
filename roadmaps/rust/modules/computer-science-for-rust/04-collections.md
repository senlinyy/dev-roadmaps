---
title: "Collections"
description: "Choose Rust collections by access pattern, memory shape, lookup behavior, iteration needs, ownership, borrowing, and practical complexity."
overview: "Collections are where typed values become useful groups of data. This article follows one small notes dataset through arrays, slices, Vec, HashMap, HashSet, BTreeMap, and Big-O in plain Rust terms."
tags: ["collections", "complexity", "vec", "hashmap"]
order: 4
id: article-rust-computer-science-for-rust-data-structures-complexity
aliases:
  - data-structures-and-complexity
  - computer-science-for-rust/04-collections.md
  - computer-science-for-rust/04-data-structures-and-complexity.md
  - computer-science-for-rust/data-and-work/04-collections.md
  - roadmaps/rust/modules/computer-science-for-rust/04-data-structures-and-complexity.md
  - roadmaps/rust/modules/computer-science-for-rust/data-and-work/04-collections.md
  - child-computer-science-for-rust-04-data-structures-and-complexity
  - child-data-and-work-04-collections
---

## Table of Contents

1. [What Is a Collection?](#what-is-a-collection)
2. [Vec](#vec)
3. [Arrays and Slices](#arrays-and-slices)
4. [HashMap](#hashmap)
5. [HashSet](#hashset)
6. [BTreeMap](#btreemap)
7. [Trees and Graphs](#trees-and-graphs)
8. [Big-O](#big-o)
9. [Ownership in Collections](#ownership-in-collections)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## What Is a Collection?

The previous articles looked at one running program, one memory shape, and one typed value at a time. Real programs usually keep groups of values: notes in a list, users by ID, tags without duplicates, tasks in sorted order, or dependencies connected to other dependencies.

A collection is a data structure that stores multiple values under one shape. The shape matters because it changes the questions that are cheap, natural, or awkward to answer.

Use this small notes program as the running example:

```bash
$ cargo new collection-notes
    Creating binary (application) `collection-notes` package
$ cd collection-notes
```

Put this in `src/main.rs`:

```rust
#[derive(Debug)]
struct Note {
    id: u32,
    title: String,
    tag: String,
}

fn main() {
    let notes = vec![
        Note {
            id: 1,
            title: String::from("Deploy notes"),
            tag: String::from("release"),
        },
        Note {
            id: 2,
            title: String::from("Fix login"),
            tag: String::from("bug"),
        },
        Note {
            id: 3,
            title: String::from("Write tests"),
            tag: String::from("quality"),
        },
    ];

    for note in &notes {
        println!("{}: {} [{}]", note.id, note.title, note.tag);
    }
}
```

Run it:

```bash
$ cargo run
   Compiling collection-notes v0.1.0 (/home/you/collection-notes)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.34s
     Running `target/debug/collection-notes`
1: Deploy notes [release]
2: Fix login [bug]
3: Write tests [quality]
```

The program uses `Vec<Note>`, a growable list of `Note` values. The loop prints the notes in the same order they were written. That is the first clue about choosing a collection: start with the question your code needs to answer.

Here are different questions about the same data:

| Question | Collection that often fits |
| --- | --- |
| Keep notes in order and scan them | `Vec<T>` |
| Pass a borrowed view of a list to a function | `&[T]` |
| Find one note by ID | `HashMap<K, V>` |
| Keep unique tags | `HashSet<T>` |
| Iterate keys in sorted order | `BTreeMap<K, V>` |
| Represent parent-child or dependency relationships | Tree or graph-shaped structures |

The access pattern is the way the program reads and writes the data: append, scan, lookup by key, check membership, keep sorted order, or follow relationships. Rust gives you several collection types because those patterns are different.

## Vec

`Vec<T>` is the standard growable list. It stores values of one type, keeps them in order, and lets you append to the end.

Here is a smaller program that prints the length and capacity:

```rust
fn main() {
    let mut titles = Vec::new();

    println!("start: len={}, cap={}", titles.len(), titles.capacity());

    titles.push(String::from("Deploy notes"));
    titles.push(String::from("Fix login"));

    println!("after push: len={}, cap={}", titles.len(), titles.capacity());

    for title in &titles {
        println!("{title}");
    }
}
```

A possible run is:

```text
start: len=0, cap=0
after push: len=2, cap=4
Deploy notes
Fix login
```

Length is the number of elements currently in the vector. Capacity is the number of elements the vector can hold before it needs to grow. The exact capacity can vary, but the relationship is stable: pushing increases length, and occasionally the vector reserves more heap space.

Indexing reads an item at a position:

```rust
fn main() {
    let titles = vec![
        String::from("Deploy notes"),
        String::from("Fix login"),
    ];

    println!("{}", titles[0]);
}
```

The output is:

```text
Deploy notes
```

Index `0` means the first element. Rust collections use zero-based indexing, so a vector with length `2` has valid indexes `0` and `1`. Indexing with `titles[2]` would panic at runtime because the index is out of bounds.

Use `.get()` when a missing index is ordinary:

```rust
fn main() {
    let titles = vec![
        String::from("Deploy notes"),
        String::from("Fix login"),
    ];

    match titles.get(2) {
        Some(title) => println!("{title}"),
        None => println!("no title at that index"),
    }
}
```

The output is:

```text
no title at that index
```

The return type of `.get(2)` is `Option<&String>`. That type says the lookup may fail because the index might be outside the vector. The collection API uses the type system to make the boundary visible.

## Arrays and Slices

An array stores a fixed number of values. The length is part of the type.

```rust
fn main() {
    let tags = ["release", "bug", "quality"];

    println!("{} tags", tags.len());
}
```

The output is:

```text
3 tags
```

The type of `tags` is `[&str; 3]`, which means an array of three string slices. Arrays are useful when the size is fixed and known.

A slice is a borrowed view into a contiguous sequence. A slice does not own the values. It gives a function access to some or all of a list without requiring a specific owner type.

```rust
fn print_titles(titles: &[String]) {
    for title in titles {
        println!("{title}");
    }
}

fn main() {
    let titles = vec![
        String::from("Deploy notes"),
        String::from("Fix login"),
        String::from("Write tests"),
    ];

    print_titles(&titles);
    print_titles(&titles[0..2]);
}
```

The output is:

```text
Deploy notes
Fix login
Write tests
Deploy notes
Fix login
```

The first call passes a borrowed view of the whole vector. The second call passes a borrowed view of the first two elements. The function signature `&[String]` says the function only needs to read a sequence of strings. It does not care whether the sequence came from a vector, an array, or a subslice.

That is why slices are common in Rust APIs. They describe the access needed by the function rather than the exact collection that owns the data.

## HashMap

`HashMap<K, V>` stores values by key. Use it when the program often asks, "which value belongs to this key?"

For notes, lookup by ID is a natural map:

```rust
use std::collections::HashMap;

#[derive(Debug)]
struct Note {
    id: u32,
    title: String,
    tag: String,
}

fn main() {
    let mut notes_by_id = HashMap::new();

    notes_by_id.insert(
        1,
        Note {
            id: 1,
            title: String::from("Deploy notes"),
            tag: String::from("release"),
        },
    );

    notes_by_id.insert(
        2,
        Note {
            id: 2,
            title: String::from("Fix login"),
            tag: String::from("bug"),
        },
    );

    match notes_by_id.get(&2) {
        Some(note) => println!("found: {}", note.title),
        None => println!("missing note"),
    }
}
```

Run it:

```text
found: Fix login
```

The key type is `u32`, and the value type is `Note`. The call `notes_by_id.get(&2)` borrows the key for lookup. The return type is `Option<&Note>` because the map may not contain that key.

A `HashMap` uses a hash of the key to decide where to store an entry internally. A hash is a value computed from the key so the map can jump near the right storage location quickly.

For a lookup like `notes_by_id.get(&2)`, the rough mechanism is:

```text
key 2
  |
  v
hash function produces a hash value
  |
  v
map uses part of that hash to choose a bucket
  |
  v
map checks entries in that bucket for an equal key
  |
  v
returns Some(&Note) or None
```

The equality check still matters because two different keys can land in the same bucket. That situation is called a collision. A good hash function spreads keys out so collisions are uncommon, but the map still has to handle them correctly. This is why the key type must support both hashing and equality.

That bucket lookup is what makes average lookup fast. The map usually avoids scanning every note. It computes where the key should be, checks that small area, and returns a borrowed value if the key is present.

The tradeoff is that iteration order is not sorted and should not be treated as meaningful:

```rust
for id in notes_by_id.keys() {
    println!("{id}");
}
```

A run might print:

```text
2
1
```

Another run, platform, or map history could produce a different order. If the program needs sorted keys, use a different collection or sort the keys before printing.

## HashSet

`HashSet<T>` stores unique values. It is useful when the question is membership: "have I seen this value?" or "which distinct values exist?"

Collect unique tags from the notes:

```rust
use std::collections::HashSet;

fn main() {
    let tags = ["release", "bug", "release", "quality"];
    let mut unique = HashSet::new();

    for tag in tags {
        unique.insert(tag);
    }

    println!("{} unique tags", unique.len());
    println!("has bug? {}", unique.contains("bug"));
}
```

Run it:

```text
3 unique tags
has bug? true
```

The input had four tag entries, but `release` appeared twice. The set stores one copy of each distinct value, so the length is `3`.

As with `HashMap`, iteration order is not sorted:

```rust
for tag in &unique {
    println!("{tag}");
}
```

Use a `HashSet` when uniqueness and fast membership checks matter more than display order.

## BTreeMap

`BTreeMap<K, V>` stores values by key in sorted key order. It is useful when you want map lookup and predictable ordered iteration.

```rust
use std::collections::BTreeMap;

fn main() {
    let mut titles = BTreeMap::new();

    titles.insert(3, "Write tests");
    titles.insert(1, "Deploy notes");
    titles.insert(2, "Fix login");

    for (id, title) in &titles {
        println!("{id}: {title}");
    }
}
```

Run it:

```text
1: Deploy notes
2: Fix login
3: Write tests
```

The insert calls were not sorted, but the output is sorted by key. That is the collection's main visible behavior.

`BTreeMap` gets that sorted behavior from its shape. It keeps keys in tree nodes so walking the tree from left to right visits keys in order. Insertions may rearrange tree nodes to keep the tree balanced, but the visible promise remains stable: iteration follows sorted key order.

That means `BTreeMap` is often a good choice for small to medium maps where predictable order matters, for range queries, or for output that should be stable. `HashMap` is often a good choice for direct key lookup when order does not matter.

| Need | Common choice |
| --- | --- |
| Fast average lookup by key | `HashMap<K, V>` |
| Sorted key iteration | `BTreeMap<K, V>` |
| Unique values without order | `HashSet<T>` |
| Unique values in sorted order | `BTreeSet<T>` |

## Trees and Graphs

Some data is shaped by relationships rather than a flat list or key-value table.

A tree has parent-child relationships. A filesystem tree is a familiar example: `/` contains directories, directories contain other directories and files, and each path follows a chain downward. A roadmap is also tree-shaped: root module, submodule, article.

A graph is more general. Values can connect to many other values. A package dependency graph is a good example: one crate can depend on several crates, and several crates can depend on the same crate.

Rust does not force one standard graph type because graph needs vary. A small tree can use structs and `Vec` fields:

```rust
struct Section {
    title: String,
    children: Vec<Section>,
}
```

A graph often uses IDs and maps:

```rust
use std::collections::HashMap;

struct DependencyGraph {
    edges: HashMap<String, Vec<String>>,
}
```

In that shape, the map key is a package name, and the vector stores the packages it depends on. IDs keep ownership simpler because edges can refer to names instead of trying to store direct references between many owned values.

The practical Rust lesson is that relationship-heavy data often needs an ownership plan. Direct references inside long-lived graph structures can become difficult because Rust must prove every reference stays valid. IDs, indexes, `Box`, `Rc`, `Arc`, or specialized crates can be better depending on the problem.

## Big-O

Big-O is a shorthand for how work grows as the input grows. It does not tell you exact speed. It tells you the shape of growth.

Use a vector search:

```rust
fn contains_title(titles: &[String], target: &str) -> bool {
    for title in titles {
        if title == target {
            return true;
        }
    }

    false
}
```

If the target is first, the function returns quickly. If the target is missing, the function checks every title. As the list grows from 10 to 10,000 items, the worst-case work grows with the list. That is called O(n), pronounced "order n".

Map lookup has a different shape:

```rust
use std::collections::HashMap;

fn main() {
    let mut by_id = HashMap::new();
    by_id.insert(1, "Deploy notes");
    by_id.insert(2, "Fix login");

    println!("{:?}", by_id.get(&2));
}
```

Average `HashMap` lookup is O(1), often called constant time. Constant time means the average amount of work does not grow in the same direct way as scanning every item. It does not mean literally free, and it does not mean every lookup always takes the exact same CPU time. It means the data structure is designed so lookup does not require checking every stored value on average.

Here is a beginner reference table:

| Operation | Common collection | Growth shape |
| --- | --- | --- |
| Read by index | `Vec<T>` | O(1) |
| Search by scanning | `Vec<T>` | O(n) |
| Push to end | `Vec<T>` | Amortized O(1) |
| Lookup by key | `HashMap<K, V>` | Average O(1) |
| Lookup by sorted key | `BTreeMap<K, V>` | O(log n) |

Amortized means occasional expensive growth is spread across many cheap operations. A vector may need to allocate a larger buffer sometimes, but most pushes are cheap.

That vector push mechanism looks like this:

```text
push when len < capacity
  -> write the new element into spare space
  -> increase len

push when len == capacity
  -> allocate a larger buffer
  -> move existing elements into the new buffer
  -> free the old buffer
  -> write the new element
  -> increase len and capacity
```

The second path is more expensive, but it happens only occasionally. That is why a long sequence of pushes is described as amortized O(1): the rare growth cost is spread across many ordinary pushes.

Use Big-O to choose the right shape when the data grows. For small data, clarity may matter more than theoretical growth. For large data, the wrong access pattern can dominate the program.

## Ownership in Collections

Collections own their elements unless you store references. That simple rule explains many beginner surprises.

This program moves strings into a vector:

```rust
fn main() {
    let title = String::from("Deploy notes");
    let mut titles = Vec::new();

    titles.push(title);

    println!("{title}");
}
```

Check it:

```text
$ cargo check
    Checking collection-notes v0.1.0 (/home/you/collection-notes)
error[E0382]: borrow of moved value: `title`
 --> src/main.rs:7:15
  |
2 |     let title = String::from("Deploy notes");
  |         ----- move occurs because `title` has type `String`
5 |     titles.push(title);
  |                 ----- value moved here
7 |     println!("{title}");
  |               ^^^^^^^ value borrowed here after move
```

`titles.push(title)` moves the `String` into the vector. After that, the vector owns it. The old local binding `title` can no longer be used as if it still owned the string.

Mechanically, the vector stores a `String` handle inside its element buffer. The text bytes do not need to be copied into the vector by `push`; the handle moves into the vector's storage.

```text
before push:
title -> String handle -> heap text "Deploy notes"
titles -> empty Vec buffer

after push:
title -> no usable String
titles[0] -> String handle -> heap text "Deploy notes"
```

The cleanup responsibility moved with the handle. When the vector is later dropped, it drops each element it owns. Dropping the `String` element frees the text allocation.

There are several valid fixes, depending on what the program means:

| Intent | Shape |
| --- | --- |
| The vector should own the string | Move it and stop using the old binding. |
| Both places need owned strings | Push `title.clone()`. |
| The vector only needs borrowed views | Store references with a lifetime that stays valid. |
| A function only needs to read the vector | Pass a slice such as `&[String]`. |

Here is the borrowed function shape:

```rust
fn print_all(titles: &[String]) {
    for title in titles {
        println!("{title}");
    }
}

fn main() {
    let titles = vec![
        String::from("Deploy notes"),
        String::from("Fix login"),
    ];

    print_all(&titles);
    println!("{} titles", titles.len());
}
```

The output is:

```text
Deploy notes
Fix login
2 titles
```

The function borrowed the collection through a slice. It did not take ownership, so `main` can still use the vector afterward.

## Putting It All Together

The notes dataset showed why collections are chosen by access pattern:

- `Vec<T>` keeps ordered growable lists and is a strong default for "append and scan".
- Arrays hold a fixed number of values, while slices borrow a view of contiguous values.
- `HashMap<K, V>` answers key lookup questions quickly on average.
- `HashSet<T>` answers uniqueness and membership questions.
- `BTreeMap<K, V>` keeps keys sorted for predictable iteration and range-friendly access.
- Trees and graphs need relationship modeling, often with IDs or pointer-like ownership tools.
- Big-O names how work grows as data grows.
- Collections own their elements unless you deliberately store references or pass borrowed views.

The practical habit is to name the question first. "I need all notes in display order" points toward a vector. "I need note 42" points toward a map. "I need each tag once" points toward a set. Rust's type system then makes the ownership and lookup behavior visible in the code.

## What's Next

The next article moves from data stored inside one program to work done by processes, child commands, threads, blocking I/O, and async waiting.

---

**References**

- [The Rust Programming Language: Common Collections](https://doc.rust-lang.org/book/ch08-00-common-collections.html) - Introduces vectors, strings, and hash maps.
- [std::vec::Vec](https://doc.rust-lang.org/std/vec/struct.Vec.html) - Documents vector length, capacity, indexing, and growth behavior.
- [std::collections](https://doc.rust-lang.org/std/collections/index.html) - Overview of Rust's standard collection types and their performance notes.
- [std::collections::HashMap](https://doc.rust-lang.org/std/collections/struct.HashMap.html) - Documents hash map behavior and APIs.
- [std::collections::BTreeMap](https://doc.rust-lang.org/std/collections/struct.BTreeMap.html) - Documents ordered map behavior and APIs.
