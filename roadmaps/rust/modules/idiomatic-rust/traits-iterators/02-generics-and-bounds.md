---
title: "Generics And Bounds"
description: "Use generics and trait bounds to write reusable Rust functions and types without hiding what behavior they require."
overview: "Traits name behavior. Generics let functions and structs accept many concrete types while trait bounds keep the requirements explicit."
tags: ["generics", "trait-bounds", "where", "api-design"]
order: 2
id: article-rust-idiomatic-rust-generics-and-bounds
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Type Parameters Are Placeholders](#type-parameters-are-placeholders)
3. [Generic Functions](#generic-functions)
4. [Trait Bounds](#trait-bounds)
5. [Same Type Or Any Type](#same-type-or-any-type)
6. [Where Clauses](#where-clauses)
7. [Clone vs Copy](#clone-vs-copy)
8. [Common Bounds](#common-bounds)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

The notes app can now define shared behavior with traits. That solves one kind of repetition. Another kind appears when functions have the same shape but different concrete types.

The app might need to:

- Pick the longest note title from a list of strings.
- Pick the highest score from a list of search matches.
- Store a page of results where the item type changes by screen.

Writing one version per type gets old quickly. Replacing types with vague data loses safety. Rust's answer is generics: write the shape once, then say what abilities the type must have.

## Type Parameters Are Placeholders

A type parameter is a placeholder for one real type chosen when the function or struct is used.

In this signature, `T` is not `any`:

```rust
fn first<T>(items: &[T]) -> Option<&T>
```

It means "for some concrete element type `T`, borrow a slice of those items and maybe return a borrowed item of that same type." If the caller passes notes, `T` is `Note` for that call. If the caller passes strings, `T` is `String` for that call.

This is close to TypeScript generics in shape, but Rust checks and compiles generic code around concrete types and explicit trait bounds. It is not dynamic duck typing.

## Generic Functions

A generic function uses a type parameter.

```rust
fn first<T>(items: &[T]) -> Option<&T> {
    items.first()
}
```

`T` stands for some concrete type chosen by the caller. If the caller passes `&[Note]`, then `T` is `Note`. If the caller passes `&[String]`, then `T` is `String`.

The function can return a borrowed item without knowing the concrete type:

```rust
let titles = vec![String::from("Rust"), String::from("Cargo")];

if let Some(title) = first(&titles) {
    println!("{title}");
}
```

This works because `first` does not need special behavior from `T`. It only borrows from a slice and returns what the slice already stores.

The moment a generic function wants to compare, clone, print, sort, or summarize values, it must ask for that behavior explicitly.

## Trait Bounds

A trait bound says what a generic type must be able to do.

```rust
fn print_item<T: std::fmt::Display>(item: T) {
    println!("{item}");
}
```

Read the colon as "must satisfy this capability." This function accepts any `T` that implements `Display`. A `String` works. An integer works. A custom type works only if it implements `Display`.

The bound is the contract. Inside the function, Rust lets you use behavior promised by the bound and nothing else.

For the notes app, a generic summary function can use the `Summary` trait from the previous article:

```rust
trait Summary {
    fn summary(&self) -> String;
}

fn collect_summaries<T: Summary>(items: &[T]) -> Vec<String> {
    items.iter().map(|item| item.summary()).collect()
}
```

The function does not know whether the items are notes, search hits, or notebook records. It only knows that each item can produce a summary.

That is the balance Rust wants: reusable code, but with visible requirements.

:::expand[Why T is not dynamic typing]{kind="design"}
Generic Rust can look like dynamic code because `T` seems to stand for "whatever." The difference is that Rust still checks what the function is allowed to do.

This generic function compiles because it only asks the slice for its first item:

```rust
fn first<T>(items: &[T]) -> Option<&T> {
    items.first()
}
```

This one does not compile:

```rust
fn print_first<T>(items: &[T]) {
    if let Some(item) = items.first() {
        println!("{item}");
    }
}
```

Rust cannot assume every possible `T` knows how to display itself with `{}`. Add the bound:

```rust
fn print_first<T: std::fmt::Display>(items: &[T]) {
    if let Some(item) = items.first() {
        println!("{item}");
    }
}
```

That is the generic contract. The function can be reused across many types, but every operation inside the function must be justified by the bounds in the signature.
:::

:::expand[Bounds are the price tag on reuse]{kind="design"}
Generics can make code look more abstract, but trait bounds keep the abstraction honest.

This function is highly reusable because it asks for almost nothing:

```rust
fn count<T>(items: &[T]) -> usize {
    items.len()
}
```

It can work for any `T` because it never looks inside an item.

This function needs more:

```rust
fn print_all<T: std::fmt::Display>(items: &[T]) {
    for item in items {
        println!("{item}");
    }
}
```

The `Display` bound is not ceremony. It is the price tag on the operation. Printing with `{}` only works for types that know how to display themselves.

This is a useful review habit:

| Function action | Likely bound |
| --- | --- |
| Only count or index items | No bound |
| Print with `{}` | `Display` |
| Print for debugging with `{:?}` | `Debug` |
| Sort values | `Ord` or `PartialOrd` |
| Duplicate values | `Clone` or sometimes `Copy` |

When a generic signature feels noisy, ask whether the function is trying to do too many things. Sometimes the right fix is a clearer bound. Sometimes it is a smaller function.
:::

## Same Type Or Any Type

`impl Trait` is a convenient shorthand for simple parameters:

```rust
fn print_summary(item: &impl Summary) {
    println!("{}", item.summary());
}
```

This accepts one value of any type that implements `Summary`.

With two parameters, the choice matters:

```rust
fn print_pair(a: &impl Summary, b: &impl Summary) {
    println!("{}", a.summary());
    println!("{}", b.summary());
}
```

Here, `a` and `b` may be different concrete types. A `Note` and a `SearchHit` can both be passed.

If both parameters must be the same concrete type, use a named generic:

```rust
fn print_matching_pair<T: Summary>(a: &T, b: &T) {
    println!("{}", a.summary());
    println!("{}", b.summary());
}
```

Now both arguments must be the same `T`.

The difference is subtle but practical. `impl Trait` says each parameter must satisfy the trait. A named type parameter says these places share one concrete type.

## Where Clauses

When bounds get longer, a `where` clause keeps the function readable.

```rust
fn debug_summaries<T>(items: &[T]) -> Vec<String>
where
    T: Summary + std::fmt::Debug,
{
    items
        .iter()
        .map(|item| format!("{:?}: {}", item, item.summary()))
        .collect()
}
```

The function name, parameters, and return type stay close together. The requirements move below the signature.

Use a `where` clause when bounds start hiding the main shape of the function. It is especially useful when there are multiple type parameters or several bounds.

:::expand[where clauses are for readers first]{kind="pattern"}
A `where` clause does not make a function more powerful. It makes the signature easier to read.

These two signatures express the same requirement:

```rust
fn save<T: Summary + std::fmt::Debug + Clone>(item: T) {
    println!("{:?}", item);
}
```

```rust
fn save<T>(item: T)
where
    T: Summary + std::fmt::Debug + Clone,
{
    println!("{:?}", item);
}
```

The first version is fine while the bound is short. The second version becomes easier once the real API has more pieces:

```rust
fn compare_and_save<T, U>(left: T, right: U)
where
    T: Summary + Clone,
    U: Summary + std::fmt::Debug,
{
    println!("{}", left.summary());
    println!("{:?}", right);
}
```

The reader can scan the function in two passes. First, what does it take and return? Second, what must those types provide?

That is the pattern: use inline bounds for simple cases, use `where` when the requirements deserve their own space.
:::

## Clone vs Copy

`Clone` and `Copy` both involve duplication, but they send different signals.

`Clone` is explicit. Calling `.clone()` can allocate memory or do work proportional to the value:

```rust
let title = String::from("Rust notes");
let saved = title.clone();
```

`Copy` is implicit and reserved for values where simple bitwise duplication is cheap and safe, such as integers and booleans:

```rust
let count = 3;
let saved = count;
println!("{count} {saved}");
```

This distinction matters in generic code. A bound of `T: Clone` says the function may explicitly duplicate values. A bound of `T: Copy` says the function only accepts types that can be duplicated invisibly by assignment.

## Common Bounds

Some bounds show up constantly in Rust code.

`Debug` is for developer-facing output:

```rust
fn inspect<T: std::fmt::Debug>(value: &T) {
    println!("{value:?}");
}
```

`Clone` means a value can be explicitly duplicated:

```rust
fn duplicate<T: Clone>(value: &T) -> T {
    value.clone()
}
```

`Copy` means a value can be duplicated by simple assignment without a visible `.clone()` call. Small numbers are `Copy`. `String` is not.

```rust
fn largest<T: Ord + Copy>(items: &[T]) -> Option<T> {
    items.iter().copied().max()
}
```

The `Copy` bound matters here because the function returns an owned `T` copied out of the slice. If `T` is a `String`, copying it would not be cheap or implicit, so this function does not accept strings.

For APIs that accept paths, strings, or borrowed views, bounds like `AsRef<Path>` can make callers comfortable without forcing allocation. Use them when the boundary benefits from flexibility. Keep inner helpers plain when a simple `&str` or slice is clearer.

## Putting It All Together

Generics let the notes app write reusable code without giving up the compiler's help:

```rust
trait Summary {
    fn summary(&self) -> String;
}

fn collect_summaries<T>(items: &[T]) -> Vec<String>
where
    T: Summary,
{
    items.iter().map(|item| item.summary()).collect()
}

fn inspect_all<T>(items: &[T])
where
    T: Summary + std::fmt::Debug,
{
    for item in items {
        println!("{:?}: {}", item, item.summary());
    }
}
```

Count back to the opener:

- One function can work for many item types.
- Trait bounds say what those item types must provide.
- `impl Trait`, named type parameters, and `where` clauses give different ways to express the same idea clearly.

Generics are not about making code abstract for its own sake. They are about removing repetition while keeping the contract visible.

## What's Next

Reusable functions still need data to operate on. The next article looks at the standard collections you will use constantly: vectors for ordered items, maps for keyed lookup, sets for uniqueness, and strings for owned text.

---

**References**

- [Generic Data Types - The Rust Programming Language](https://doc.rust-lang.org/book/ch10-01-syntax.html)
- [Defining Shared Behavior with Traits - The Rust Programming Language](https://doc.rust-lang.org/book/ch10-02-traits.html)
- [AsRef - Rust standard library](https://doc.rust-lang.org/std/convert/trait.AsRef.html)
