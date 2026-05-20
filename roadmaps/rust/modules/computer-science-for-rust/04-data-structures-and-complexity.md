---
title: "Data Structures and Complexity"
description: "Understand why Rust collection choices change memory layout, lookup behavior, iteration, ownership, borrowing, and performance."
overview: "Collections are where ownership meets everyday computer science. This article explains vectors, slices, maps, sets, trees, graphs, and Big-O in plain Rust terms."
tags: ["data-structures", "complexity", "vec", "hashmap"]
order: 4
id: article-rust-computer-science-for-rust-data-structures-complexity
---

## Table of Contents

1. [What Is a Data Structure?](#what-is-a-data-structure)
2. [Arrays, Slices, and Vec](#arrays-slices-and-vec)
3. [HashMap](#hashmap)
4. [HashSet](#hashset)
5. [BTreeMap and Ordered Data](#btreemap-and-ordered-data)
6. [Trees and Graphs](#trees-and-graphs)
7. [Big-O](#big-o)
8. [Ownership in Collections](#ownership-in-collections)

## What Is a Data Structure?

A data structure is a way to arrange values so a program can use them. The arrangement changes which operations are easy, which operations are expensive, and how ownership works.

Suppose a notes program stores notes like this:

```rust
struct Note {
    id: u64,
    title: String,
    body: String,
}
```

If you store notes in a `Vec<Note>`, the notes stay in a simple ordered list. That is good for showing all notes in order:

```rust
let notes: Vec<Note> = Vec::new();
```

If you often need to open one note by ID, a `HashMap<u64, Note>` may fit better:

```rust
use std::collections::HashMap;

let notes_by_id: HashMap<u64, Note> = HashMap::new();
```

The note data is the same, but the data structure changes the cost of common operations. Rust adds another question: who owns the notes, and who only borrows them?

## Arrays, Slices, and Vec

An array owns a fixed number of elements:

```rust
let ports = [80, 443, 8080];
```

The length is part of the type. An array of three `u16` values has a different type from an array of four `u16` values.

A slice is a borrowed view of a sequence:

```rust
fn print_ports(ports: &[u16]) {
    for port in ports {
        println!("{port}");
    }
}
```

The function can accept a slice borrowed from an array or a vector:

```rust
fn main() {
    let fixed = [80, 443];
    print_ports(&fixed);

    let dynamic = vec![3000, 8080];
    print_ports(&dynamic);
}
```

This is why slices are common in Rust APIs. They let a function read ordered data without owning the collection.

A vector owns a growable sequence:

```rust
fn main() {
    let mut names = Vec::new();
    names.push(String::from("Ada"));
    names.push(String::from("Grace"));

    println!("{names:?}");
}
```

The output is:

```text
["Ada", "Grace"]
```

`Vec<T>` stores elements in order and is efficient to iterate. Indexing by a valid index is fast:

```rust
println!("{}", names[0]);
```

Safe code still needs to handle invalid indexes. Direct indexing with an invalid index panics. The `get` method returns `Option`:

```rust
match names.get(10) {
    Some(name) => println!("{name}"),
    None => println!("no name at that index"),
}
```

## HashMap

A `HashMap<K, V>` stores values by key.

```rust
use std::collections::HashMap;

fn main() {
    let mut scores = HashMap::new();
    scores.insert(String::from("Ada"), 10);
    scores.insert(String::from("Grace"), 20);

    println!("{:?}", scores.get("Ada"));
}
```

The output is:

```text
Some(10)
```

The map uses the key's hash and equality behavior to find the value. This makes lookup fast on average. A map is a good choice when the main question is "what value belongs to this key?"

Hash maps do not give a stable sorted order. If you print or loop over a `HashMap`, the order should not be treated as a display order:

```rust
for (name, score) in &scores {
    println!("{name}: {score}");
}
```

Use a separate sorted list, sort the keys, or use an ordered map when output order matters.

The ownership rule is also visible. This line moves the `String` key into the map:

```rust
scores.insert(String::from("Linus"), 30);
```

After insertion, the map owns that key and value.

## HashSet

A `HashSet<T>` tracks membership. It stores values without a separate value under each key.

```rust
use std::collections::HashSet;

fn main() {
    let mut tags = HashSet::new();
    tags.insert("rust");
    tags.insert("cargo");

    println!("{}", tags.contains("rust"));
}
```

The output is:

```text
true
```

Sets are useful for deduplication, visited IDs, feature names, permissions, and tags. If the question is "have I seen this value?", a set is often clearer than a vector scan.

For example, deduplicate a list:

```rust
use std::collections::HashSet;

fn main() {
    let names = ["Ada", "Grace", "Ada"];
    let unique: HashSet<&str> = names.into_iter().collect();

    println!("{}", unique.len());
}
```

The output is:

```text
2
```

Like `HashMap`, `HashSet` does not provide sorted output order.

## BTreeMap and Ordered Data

`BTreeMap<K, V>` stores key-value pairs in key order. It is useful when you need ordered iteration.

```rust
use std::collections::BTreeMap;

fn main() {
    let mut scores = BTreeMap::new();
    scores.insert("Grace", 20);
    scores.insert("Ada", 10);
    scores.insert("Linus", 30);

    for (name, score) in scores {
        println!("{name}: {score}");
    }
}
```

The output is sorted by key:

```text
Ada: 10
Grace: 20
Linus: 30
```

This is the tradeoff. `HashMap` is usually the first choice for fast average lookup. `BTreeMap` is useful when ordering is part of the behavior you need.

## Trees and Graphs

A tree stores parent-child data. Each child has one parent in the simple case.

```rust
struct Node {
    name: String,
    children: Vec<Node>,
}
```

This works well in Rust because ownership flows from parent to child. The parent owns its children through the vector. When the parent is dropped, the children are dropped too.

Graphs are harder because nodes can have many relationships. A node may point to several other nodes, and several nodes may point to the same node.

One Rust-friendly way to represent a graph is to store nodes in a vector and use indexes for links:

```rust
struct Node {
    name: String,
    links: Vec<usize>,
}

struct Graph {
    nodes: Vec<Node>,
}
```

The `Graph` owns all nodes. Each node stores indexes into the vector instead of owning other nodes directly. This avoids ownership cycles and is often easier than trying to make every node point to every other node with references.

More advanced graph code may use arenas, `Rc<T>`, `Arc<T>`, weak references, or interior mutability. Those tools are different answers to the same ownership question: who owns each node, and how can other nodes refer to it safely?

## Big-O

Big-O notation describes how work grows as input grows. It does not give exact timing. It tells you the shape of growth.

| Big-O | Meaning | Example |
| --- | --- | --- |
| O(1) | Constant work | Getting vector length |
| O(n) | Work grows with item count | Scanning a vector |
| O(log n) | Work grows slowly as data doubles | Looking up in a balanced tree |
| O(n log n) | Common sorting growth | Sorting a vector |

A vector scan is O(n):

```rust
fn find_note(notes: &[Note], id: u64) -> Option<&Note> {
    notes.iter().find(|note| note.id == id)
}
```

If there are ten notes, scanning is fine. If there are ten million notes and this lookup happens constantly, the scan can become expensive.

A hash map lookup is fast on average:

```rust
fn find_note(notes: &HashMap<u64, Note>, id: u64) -> Option<&Note> {
    notes.get(&id)
}
```

Big-O is one part of the decision. Memory use, ordering, simplicity, key hashing, and ownership all matter too.

## Ownership in Collections

Collections own their elements unless you store references.

```rust
fn main() {
    let mut names: Vec<String> = Vec::new();
    let name = String::from("Ada");

    names.push(name);
    println!("{names:?}");
}
```

After `names.push(name)`, the vector owns the string. The old `name` binding cannot be used.

Borrow when a function only needs to read:

```rust
fn print_names(names: &[String]) {
    for name in names {
        println!("{name}");
    }
}
```

Take ownership when a function needs to consume the collection:

```rust
fn count_names(names: Vec<String>) -> usize {
    names.len()
}
```

Borrow mutably when a function needs to change the collection:

```rust
fn add_name(names: &mut Vec<String>, name: String) {
    names.push(name);
}
```

Here is a quick reference:

| Function parameter | Meaning |
| --- | --- |
| `Vec<T>` | Function takes ownership of the whole vector |
| `&[T]` | Function borrows a read-only view |
| `&mut Vec<T>` | Function can change the vector |
| `HashMap<K, V>` | Function takes ownership of the map |
| `&HashMap<K, V>` | Function reads the map |
| `&mut HashMap<K, V>` | Function can insert, remove, or change entries |

This is why collection choice in Rust is both a data-structure question and an ownership question. The collection decides how values are arranged. The function signature decides who owns or borrows that arrangement.

---

**References**

- [Rust Standard Library: Collections](https://doc.rust-lang.org/std/collections/) - Official overview of Rust collection types and when to use them.
- [Rust Standard Library: Vec](https://doc.rust-lang.org/std/vec/struct.Vec.html) - Official documentation for `Vec<T>` and growable contiguous storage.
- [Rust Standard Library: HashMap](https://doc.rust-lang.org/std/collections/struct.HashMap.html) - Official documentation for hash maps and keyed lookup.
- [Rust Standard Library: HashSet](https://doc.rust-lang.org/std/collections/struct.HashSet.html) - Official documentation for hash sets and membership tracking.
- [Rust Standard Library: BTreeMap](https://doc.rust-lang.org/std/collections/struct.BTreeMap.html) - Official documentation for ordered maps.
- [Rust Standard Library: Slice](https://doc.rust-lang.org/std/primitive.slice.html) - Official documentation for borrowed sequence views.
