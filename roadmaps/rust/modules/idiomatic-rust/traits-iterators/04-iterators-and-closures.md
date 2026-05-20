---
title: "Iterators And Closures"
description: "Transform Rust collections with iterators, closures, adapter chains, collect, and ownership-aware loop choices."
overview: "Collections hold data. Iterators are the idiomatic way to read, filter, transform, and collect that data while making ownership choices explicit."
tags: ["iterators", "closures", "collect", "ownership"]
order: 4
id: article-rust-idiomatic-rust-iterators-and-closures
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Iterator Flow](#iterator-flow)
3. [Lazy Pipelines](#lazy-pipelines)
4. [Closures](#closures)
5. [What Closures Capture](#what-closures-capture)
6. [iter, iter_mut, into_iter](#iter-iter_mut-into_iter)
7. [Collect](#collect)
8. [Readable Chains](#readable-chains)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

The notes app now stores data in collections. The next feature is a search result list.

Given a list of notes, the app should:

- Keep only notes with a matching tag.
- Convert each matching note into a short display string.
- Leave the original notes available for the rest of the program.

You can write that with a loop, and loops are fine in Rust. But Rust code often reaches for iterators because they make the data flow visible: start with a sequence, apply small transformations, and collect the result.

## Iterator Flow

An iterator is a value that produces items one at a time.

Most collection iterator code starts with `iter()`:

```rust
let titles = notes
    .iter()
    .map(|note| note.title.as_str())
    .collect::<Vec<_>>();
```

Read that chain from top to bottom:

1. Borrow each note from `notes`.
2. Map each note to a borrowed title.
3. Collect the titles into a vector.

The chain is lazy until `collect` asks for the results. The `map` step describes a transformation, but it does not build a new vector by itself.

This differs from JavaScript array `.map()`, which immediately creates a new array. Rust iterator adapters are closer to Python generator pipelines: they describe work that will happen later when something consumes the iterator.

This is why iterator chains can be efficient and readable. Each adapter describes the next step. The final consumer, such as `collect`, `count`, `any`, or `find`, asks the iterator to run.

## Lazy Pipelines

Laziness means the pipeline waits until a consumer asks for values.

```rust
let pipeline = notes
    .iter()
    .filter(|note| note.tags.contains("rust"))
    .map(|note| note.title.as_str());
```

At this point, the code has not built a result list. It has built a value that knows how to produce matching titles. The work runs when a consumer appears:

```rust
let titles: Vec<&str> = pipeline.collect();
```

That split is why Rust can chain several transformations without allocating intermediate vectors. It is also why an unused iterator chain is usually a bug: describing work is not the same thing as running it.

:::expand[Adapters describe work, consumers run it]{kind="design"}
Iterator methods fall into two broad groups.

Adapters create a new iterator:

```rust
let matching = notes
    .iter()
    .filter(|note| note.tags.contains("rust"))
    .map(|note| note.title.as_str());
```

At this point, no result vector exists. The code has built a pipeline that knows how to produce matching titles when asked.

Consumers drive the iterator:

```rust
let titles: Vec<&str> = matching.collect();
```

`collect` repeatedly asks the pipeline for the next item until there are no more.

This split explains a common beginner confusion. If you write this and never use the result, nothing useful happens:

```rust
notes.iter().map(|note| note.title.as_str());
```

The compiler may warn because the iterator pipeline was created and ignored. Add a consumer when you want the work to happen:

```rust
let count = notes
    .iter()
    .filter(|note| note.tags.contains("rust"))
    .count();
```

The design gives Rust room to combine steps without allocating intermediate collections unless you ask for one.
:::

## Closures

A closure is an inline function-like value. Iterator adapters use closures heavily because each step needs a small bit of behavior.

```rust
let short_titles: Vec<&str> = notes
    .iter()
    .filter(|note| note.title.len() <= 20)
    .map(|note| note.title.as_str())
    .collect();
```

The `|note| ...` syntax means "take a note and run this expression."

Closures can also capture values from the surrounding scope:

```rust
let selected_tag = "rust";

let results: Vec<&Note> = notes
    .iter()
    .filter(|note| note.tags.contains(selected_tag))
    .collect();
```

The closure borrows `selected_tag` from the surrounding function. That is one reason closures fit Rust's ownership model well: capture behavior follows the same borrowing and moving rules as the rest of the language.

## What Closures Capture

A closure can use values from the surrounding scope. Rust decides whether it can borrow, mutably borrow, or move those values based on what the closure does.

This closure only reads `selected_tag`, so it can borrow it:

```rust
let selected_tag = String::from("rust");

let results: Vec<&Note> = notes
    .iter()
    .filter(|note| note.tags.contains(selected_tag.as_str()))
    .collect();
```

If a closure needs to keep a value after the surrounding function continues, Rust may require `move` so the closure owns what it uses. That appears often with threads and async tasks later.

:::expand[move closures and captured ownership]{kind="pattern"}
The `move` keyword on a closure means the closure takes ownership of the values it captures.

Without `move`, this closure can borrow `label` while it is called immediately:

```rust
let label = String::from("note");
let print = || println!("{label}");

print();
println!("{label}");
```

With `move`, the closure owns `label`:

```rust
let label = String::from("note");
let print = move || println!("{label}");

print();
```

Now the original `label` binding is no longer available after the closure is created. That may look inconvenient, but it is exactly what you want when the closure might outlive the current stack frame.

You will see this shape later:

```rust
std::thread::spawn(move || {
    println!("{label}");
});
```

The spawned thread may run after the current function returns, so borrowing a local variable would be unsafe. `move` transfers ownership into the closure so the data lives where the closure needs it.
:::

## iter, iter_mut, into_iter

The iterator method you choose is an ownership decision.

`iter()` borrows each item:

```rust
for note in notes.iter() {
    println!("{}", note.title);
}

println!("still have {} notes", notes.len());
```

`iter_mut()` mutably borrows each item:

```rust
for note in notes.iter_mut() {
    note.title = note.title.trim().to_string();
}
```

`into_iter()` consumes the collection and yields owned items:

```rust
let titles: Vec<String> = notes
    .into_iter()
    .map(|note| note.title)
    .collect();
```

After `into_iter()`, the original vector is gone. That is exactly right when the code is converting one owned collection into another owned collection.

| Method | Item type idea | Original collection |
| --- | --- | --- |
| `iter()` | `&T` | Still usable |
| `iter_mut()` | `&mut T` | Still usable after mutation |
| `into_iter()` | `T` | Consumed |

The method name tells you whether the chain is reading, editing, or taking ownership.

:::expand[Most iterator bugs are ownership mismatches]{kind="pitfall"}
When an iterator chain fights you, the problem is often that the chain picked the wrong ownership mode.

This consumes the notes:

```rust
let titles: Vec<String> = notes
    .into_iter()
    .map(|note| note.title)
    .collect();

println!("{}", notes.len());
```

The final line cannot compile because `notes` was moved by `into_iter()`. The chain took each `Note` out of the vector, then moved each `title` out of each note.

If you only need to display titles, borrow:

```rust
let titles: Vec<&str> = notes
    .iter()
    .map(|note| note.title.as_str())
    .collect();

println!("{}", notes.len());
```

If you need owned titles while keeping the notes, clone deliberately:

```rust
let titles: Vec<String> = notes
    .iter()
    .map(|note| note.title.clone())
    .collect();
```

That clone is a visible cost. Rust makes you choose between borrowing, consuming, and duplicating instead of hiding the decision inside the collection library.
:::

## Collect

`collect` turns an iterator into a collection.

Rust often needs help knowing which collection you want:

```rust
let titles: Vec<&str> = notes
    .iter()
    .map(|note| note.title.as_str())
    .collect();
```

The type annotation tells `collect` to build a `Vec<&str>`.

You can also use turbofish syntax:

```rust
let titles = notes
    .iter()
    .map(|note| note.title.as_str())
    .collect::<Vec<_>>();
```

The `_` lets Rust infer the item type while you name the collection type.

`collect` can also collect into `Result` when the iterator produces results:

```rust
let numbers: Result<Vec<u32>, _> = ["1", "2", "x"]
    .iter()
    .map(|text| text.parse::<u32>())
    .collect();
```

If every parse succeeds, the result is `Ok(Vec<u32>)`. If one parse fails, the result is `Err(...)`. This is a powerful pattern because it keeps fallible transformations compact and honest.

## Readable Chains

Iterator chains should make the data flow clearer, not more mysterious.

This is fine:

```rust
let summaries: Vec<String> = notes
    .iter()
    .filter(|note| note.tags.contains("rust"))
    .map(|note| format!("{}: {}", note.title, note.body.lines().next().unwrap_or("")))
    .collect();
```

If a closure grows too large, give the operation a name:

```rust
fn note_summary(note: &Note) -> String {
    format!("{}: {}", note.title, note.body.lines().next().unwrap_or(""))
}

let summaries: Vec<String> = notes
    .iter()
    .filter(|note| note.tags.contains("rust"))
    .map(note_summary)
    .collect();
```

Idiomatic Rust is not a contest to remove every loop. Use a loop when it is clearer, especially when there are multiple side effects or early decisions. Use iterators when the code is naturally a sequence transformation.

## Putting It All Together

The notes search can now read like a pipeline:

```rust
use std::collections::HashSet;

struct Note {
    title: String,
    body: String,
    tags: HashSet<String>,
}

fn search_summaries(notes: &[Note], tag: &str) -> Vec<String> {
    notes
        .iter()
        .filter(|note| note.tags.contains(tag))
        .map(|note| {
            let first_line = note.body.lines().next().unwrap_or("");
            format!("{}: {}", note.title, first_line)
        })
        .collect()
}
```

The function borrows the notes slice, borrows each note during iteration, filters by tag, creates owned summary strings, and collects those strings into a new vector.

Count back to the opener:

- Matching notes: `filter`.
- Display strings: `map`.
- New result list: `collect`.
- Original notes still available: `iter`, not `into_iter`.

The chain is idiomatic because each step names one transformation and the ownership choice is visible.

## What's Next

Traits, generics, collections, and iterators help you write Rust code that feels natural. The next cluster is about keeping that code trustworthy over time: tests, documentation, formatting, and linting.

---

**References**

- [Processing a Series of Items with Iterators - The Rust Programming Language](https://doc.rust-lang.org/book/ch13-02-iterators.html)
- [Iterator - Rust standard library](https://doc.rust-lang.org/std/iter/trait.Iterator.html)
- [Closures - Rust By Example](https://doc.rust-lang.org/rust-by-example/fn/closures.html)
