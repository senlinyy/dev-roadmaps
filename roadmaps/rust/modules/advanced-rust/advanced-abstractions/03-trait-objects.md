---
title: "Trait Objects"
description: "Use dyn Trait and Box<dyn Trait> when runtime polymorphism is a better fit than generics."
overview: "Generics choose concrete types at compile time. Trait objects let Rust store values with different concrete types behind one shared behavior at runtime."
tags: ["trait-objects", "dyn-trait", "dynamic-dispatch"]
order: 3
id: article-rust-advanced-rust-trait-objects
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Generics Choose One Type](#generics-choose-one-type)
3. [dyn Trait](#dyn-trait)
4. [Boxed Trait Objects](#boxed-trait-objects)
5. [Dynamic Dispatch](#dynamic-dispatch)
6. [Object Safety](#object-safety)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Problem

The notes app now supports exporting notes. One exporter writes plain text. Another writes markdown. Another writes JSON. The user can enable several exporters in a config file.

Each exporter has different internal data:

- The text exporter has a line width.
- The markdown exporter has heading style settings.
- The JSON exporter has pretty-printing options.

Generics are excellent when one concrete type is chosen by the caller. Here, the app wants a list containing several different exporter types at runtime. This is where trait objects fit.

## Generics Choose One Type

A generic function chooses a concrete type for each call.

```rust
trait Exporter {
    fn export(&self, note: &Note) -> String;
}

fn run_export<E: Exporter>(exporter: &E, note: &Note) -> String {
    exporter.export(note)
}
```

This is fast and clear. Rust knows the concrete type `E` at compile time for each call.

But a vector has one item type. This does not work:

```rust
let exporters = vec![TextExporter, JsonExporter];
```

`TextExporter` and `JsonExporter` are different concrete types, even if they both implement `Exporter`.

The app needs a way to say: this list stores values that all implement `Exporter`, even though their concrete types differ.

## dyn Trait

`dyn Trait` means a trait object.

You usually see it behind a pointer:

```rust
fn export_with(exporter: &dyn Exporter, note: &Note) -> String {
    exporter.export(note)
}
```

The function receives a borrowed trait object. It can call methods from the `Exporter` trait without knowing the concrete exporter type.

The `dyn` keyword is a useful signal. It tells the reader that method calls go through runtime dispatch rather than compile-time generic dispatch.

## Boxed Trait Objects

To store different exporters in one vector, put trait objects behind `Box`.

```rust
struct Note {
    title: String,
    body: String,
}

trait Exporter {
    fn export(&self, note: &Note) -> String;
}

struct TextExporter;
struct JsonExporter;

impl Exporter for TextExporter {
    fn export(&self, note: &Note) -> String {
        format!("{}\n{}", note.title, note.body)
    }
}

impl Exporter for JsonExporter {
    fn export(&self, note: &Note) -> String {
        format!(r#"{{"title":"{}"}}"#, note.title)
    }
}

let exporters: Vec<Box<dyn Exporter>> = vec![
    Box::new(TextExporter),
    Box::new(JsonExporter),
];
```

The vector stores boxes. Each box owns a concrete exporter on the heap. The vector's item type is now one type: `Box<dyn Exporter>`.

:::expand[Use trait objects for runtime choice]{kind="pattern"}
Use generics when the caller chooses one concrete type at compile time. Use trait objects when the program needs to choose from multiple implementations at runtime.

For exporters, the config file might decide the list:

```text
exporters = ["text", "json"]
```

The app can build a vector:

```rust
let exporters: Vec<Box<dyn Exporter>> = vec![
    Box::new(TextExporter),
    Box::new(JsonExporter),
];
```

Each item has the same behavior but a different concrete type.

Decision table:

| Need | Good fit |
| --- | --- |
| One function accepts any one type | Generic `T: Trait` |
| A struct stores one configurable strategy type | Generic struct |
| A vector stores many implementation types | `Vec<Box<dyn Trait>>` |
| Plugins chosen from config | Trait objects |

Trait objects are not "better generics." They solve a different timing problem: runtime choice instead of compile-time choice.
:::

## Dynamic Dispatch

Calling a method on a trait object uses dynamic dispatch.

Rust stores enough information with the trait object to find the right method implementation at runtime. That extra lookup has a small cost. It also prevents some compiler optimizations that are easier with generics.

For many application designs, that cost is not important. Exporting notes, rendering UI components, or choosing a plugin usually cares more about design flexibility than about one indirect method call.

Use the simplest design that matches the choice:

| Choice happens | Shape |
| --- | --- |
| Compile time | Generics |
| Runtime | Trait object |

If performance becomes important, measure before replacing trait objects with generics.

## Object Safety

Not every trait can become a trait object.

The short version is: a trait object needs methods Rust can call through a runtime table. Some trait features make that impossible or ambiguous.

This trait works well:

```rust
trait Exporter {
    fn export(&self, note: &Note) -> String;
}
```

This trait is not a good trait object shape:

```rust
trait CloneExporter {
    fn clone_exporter(&self) -> Self;
}
```

Returning `Self` is a problem because `dyn CloneExporter` does not know the concrete return type in a simple uniform way.

Do not start by memorizing every object-safety rule. Start with the design question: does the trait describe behavior that can be called through `&dyn Trait` or `Box<dyn Trait>`? If not, use generics or reshape the trait.

## Putting It All Together

The notes app can store runtime-selected exporters:

```rust
struct Note {
    title: String,
    body: String,
}

trait Exporter {
    fn export(&self, note: &Note) -> String;
}

fn export_all(note: &Note, exporters: &[Box<dyn Exporter>]) -> Vec<String> {
    exporters
        .iter()
        .map(|exporter| exporter.export(note))
        .collect()
}
```

Count back to the opener:

- The app has several exporter implementations.
- The config can choose more than one at runtime.
- `Box<dyn Exporter>` gives the vector one item type.
- Dynamic dispatch calls the right implementation.

Trait objects are useful when the program's shape is runtime-pluggable.

## What's Next

Trait objects make runtime behavior flexible. The next article returns to lifetimes, where advanced Rust often asks a different question: how long can borrowed data stay connected to the source it came from?

---

**References**

- [Using Trait Objects to Abstract over Shared Behavior - The Rust Programming Language](https://doc.rust-lang.org/book/ch18-02-trait-objects.html)
- [dyn keyword - Rust Reference](https://doc.rust-lang.org/reference/types/trait-object.html)
- [Dynamically Sized Types - The Rust Programming Language](https://doc.rust-lang.org/book/ch20-03-advanced-types.html)
