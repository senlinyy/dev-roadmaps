---
title: "Traits"
description: "Share behavior across Rust types with traits, implementations, default methods, and trait parameters."
overview: "After ownership and error handling, Rust starts to feel more expressive when different types can promise the same behavior. Traits are the first step toward reusable, idiomatic APIs."
tags: ["traits", "behavior", "impl", "derive"]
order: 1
id: article-rust-idiomatic-rust-traits
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Shared Behavior](#shared-behavior)
3. [Trait vs Interface](#trait-vs-interface)
4. [Implementing Traits](#implementing-traits)
5. [Trait Parameters](#trait-parameters)
6. [Default Methods](#default-methods)
7. [Derived Traits](#derived-traits)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

The notes app now has real data and honest error handling. The next pressure is reuse. A note can be displayed as plain text. A markdown note can be rendered differently. A search result can also be summarized for a list view.

Those types are not the same data:

- `Note` has a title and body.
- `MarkdownNote` has markdown text that may need cleaning before display.
- `SearchHit` has a note title plus the matching line.

But the app wants to ask each one the same question: "What text should I show in a compact list?"

Some languages reach for inheritance here. Rust reaches for traits. A trait names behavior a type can provide. The data stays in structs and enums. The shared promise lives in the trait.

## Shared Behavior

A trait is a set of methods that a type promises to implement.

For the notes app, the shared behavior can be called `Summary`:

```rust
trait Summary {
    fn summary(&self) -> String;
}
```

This trait says: any type that implements `Summary` can be asked for a `summary`.

The trait does not say what fields the type must have. It does not create a parent class. It only describes the behavior the caller can rely on.

That distinction matters. A `Note` and a `SearchHit` can have different shapes and still both implement `Summary`.

```rust
struct Note {
    title: String,
    body: String,
}

struct SearchHit {
    title: String,
    line: String,
}
```

The app can keep the data model honest while still giving the UI one behavior to call.

## Trait vs Interface

If you know TypeScript interfaces or Python protocols, start there: a trait says which methods a value must offer. The Rust difference is that the implementation can live in a separate `impl Trait for Type` block.

That separate implementation matters. The struct definition owns the data shape. The trait implementation owns one behavior promise. A type can implement many traits without inheriting from a parent class.

The analogy also has limits. TypeScript interfaces often describe field shape. Rust traits describe behavior. A value does not implement `Summary` because it happens to have a `summary` field or a matching object shape. It implements `Summary` because there is an explicit implementation the compiler can check.

:::expand[Traits name behavior, not ancestry]{kind="design"}
Traits are often compared to interfaces, and that comparison is useful at first. Both let code depend on behavior instead of a concrete type.

The Rust version has a different feel because traits are not tied to inheritance. A type does not need to sit under a parent type to share behavior. It simply implements the trait.

That matters when the app grows. Imagine these three types:

```rust
struct Note {
    title: String,
    body: String,
}

struct Notebook {
    name: String,
    note_count: usize,
}

struct SearchHit {
    title: String,
    line: String,
}
```

They do not have one obvious parent. A `Notebook` is not a kind of `Note`. A `SearchHit` is not a stored note. But all three can offer a compact display string.

The design pressure is separation. Structs describe what data a value owns. Traits describe what a caller may ask the value to do. That separation keeps Rust APIs from forcing false family trees just to reuse one method name.
:::

## Implementing Traits

Implementing a trait means writing an `impl Trait for Type` block.

```rust
impl Summary for Note {
    fn summary(&self) -> String {
        format!("{}: {}", self.title, self.body.lines().next().unwrap_or(""))
    }
}

impl Summary for SearchHit {
    fn summary(&self) -> String {
        format!("{} -> {}", self.title, self.line)
    }
}
```

Each type chooses the behavior that fits its own data. `Note` uses its title and first body line. `SearchHit` shows the title and matching line.

Once a type implements a trait, callers can use the trait method:

```rust
let note = Note {
    title: String::from("Rust"),
    body: String::from("Traits share behavior."),
};

println!("{}", note.summary());
```

The method call looks ordinary. The difference is where the method was promised. The trait gave the method a shared name and signature. The implementation gave it type-specific behavior.

## Trait Parameters

Traits become more powerful when a function accepts any type that implements a trait.

```rust
fn print_summary(item: &impl Summary) {
    println!("{}", item.summary());
}
```

This function does not care whether `item` is a `Note`, `SearchHit`, or another type. It only cares that `item` implements `Summary`.

That is the everyday use of trait-based design. The function depends on the behavior it needs, not on every concrete type the program currently has.

```rust
let hit = SearchHit {
    title: String::from("Rust"),
    line: String::from("trait Summary"),
};

print_summary(&hit);
```

If a caller passes a type that does not implement `Summary`, the code does not compile. Rust catches the missing behavior at compile time instead of letting the function fail later.

:::expand[Why Rust Limits External Trait Implementations]{kind="pitfall"}
Rust has a rule that can surprise beginners: you can implement a trait for a type only when the trait or the type belongs to your crate.

This is allowed:

```rust
impl Summary for Note {
    fn summary(&self) -> String {
        self.title.clone()
    }
}
```

`Summary` and `Note` are both local to the app.

This is not allowed:

```rust
impl std::fmt::Display for Vec<Note> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} notes", self.len())
    }
}
```

`Display` comes from the standard library, and `Vec` also comes from the standard library. The app owns neither the trait nor the outer type.

The rule exists so two crates cannot both decide what `Display for Vec<Note>` means and then collide in a third program. Rust calls this part of coherence. The practical workaround is usually simple: create a local wrapper type.

```rust
struct Notes(Vec<Note>);
```

Now the app owns `Notes`, so it can implement external traits for it. The rule feels strict at first, but it keeps trait behavior predictable across crates.
:::

## Default Methods

A trait method can have a default implementation.

```rust
trait Summary {
    fn title(&self) -> &str;

    fn summary(&self) -> String {
        self.title().to_string()
    }
}
```

Now a type only has to implement `title` to get a basic `summary`.

```rust
impl Summary for Note {
    fn title(&self) -> &str {
        &self.title
    }
}
```

Default methods are useful when many types share the same common behavior but a few need to customize it.

```rust
impl Summary for SearchHit {
    fn title(&self) -> &str {
        &self.title
    }

    fn summary(&self) -> String {
        format!("{} -> {}", self.title, self.line)
    }
}
```

This is a small but important design tool. The trait can define the common path, while each type can still override behavior when its data needs something different.

## Derived Traits

Some traits are so common that Rust can implement them for you.

```rust
#[derive(Debug, Clone, PartialEq)]
struct Note {
    title: String,
    body: String,
}
```

`Debug` makes the value printable with `{:?}`. `Clone` lets you explicitly duplicate it. `PartialEq` lets you compare two notes with `==`.

These derives are not magic decorations. They generate trait implementations based on the fields. That is why every field must also support the derived behavior.

If `Note` derives `Clone`, then `String` fields are fine because `String` implements `Clone`. If a field does not implement `Clone`, Rust cannot derive `Clone` for the whole struct.

Use derives when the automatic behavior matches the meaning of the type. Write the implementation yourself when the meaning needs care.

## Putting It All Together

Traits let the notes app share behavior without flattening all data into one shape:

```rust
trait Summary {
    fn summary(&self) -> String;
}

struct Note {
    title: String,
    body: String,
}

struct SearchHit {
    title: String,
    line: String,
}

impl Summary for Note {
    fn summary(&self) -> String {
        format!("{}: {}", self.title, self.body.lines().next().unwrap_or(""))
    }
}

impl Summary for SearchHit {
    fn summary(&self) -> String {
        format!("{} -> {}", self.title, self.line)
    }
}

fn print_summary(item: &impl Summary) {
    println!("{}", item.summary());
}
```

Count back to the opener:

- `Note` and `SearchHit` keep their own data shapes.
- `Summary` names the behavior the UI needs.
- `print_summary` depends on the trait instead of one concrete type.

That is the first move toward idiomatic Rust APIs: name the behavior you need, implement it on the types that can provide it, and let the compiler enforce the promise.

## What's Next

Traits are the behavior side of reusable Rust. The next article adds generics and trait bounds, so functions and structs can work with many types while still saying exactly what behavior those types must provide.

---

**References**

- [Defining Shared Behavior with Traits - The Rust Programming Language](https://doc.rust-lang.org/book/ch10-02-traits.html)
- [Derivable Traits - The Rust Programming Language](https://doc.rust-lang.org/book/appendix-03-derivable-traits.html)
- [std::fmt::Debug - Rust standard library](https://doc.rust-lang.org/std/fmt/trait.Debug.html)
