---
title: "Advanced Lifetimes"
description: "Use explicit lifetimes in structs, returned references, parsed views, and API boundaries without over-borrowing your design."
overview: "Most Rust lifetimes are inferred. Advanced lifetime design appears when a type stores references or a function returns borrowed data connected to an input."
tags: ["lifetimes", "borrowing", "api-design"]
order: 4
id: article-rust-advanced-rust-advanced-lifetimes
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Lifetimes Name Relationships](#lifetimes-name-relationships)
3. [Borrowed Structs](#borrowed-structs)
4. [Returned References](#returned-references)
5. [Elision Limits](#elision-limits)
6. [Avoiding Over-Borrowed APIs](#avoiding-over-borrowed-apis)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Problem

The notes parser can avoid copying text by returning slices into the original document.

That sounds efficient:

```rust
struct ParsedNote<'a> {
    title: &'a str,
    body: &'a str,
}
```

But it creates a real constraint. The parsed note cannot outlive the source text. If the source string is dropped, the slices would point at invalid memory. Rust uses lifetimes to express that relationship.

Advanced lifetime work is not about sprinkling annotations until the compiler stops complaining. It is about deciding which values borrow from which sources, and whether that borrowing is worth the API constraint.

## Lifetimes Name Relationships

A lifetime annotation does not keep a value alive. It names a relationship the compiler checks.

```rust
fn first_line<'a>(text: &'a str) -> Option<&'a str> {
    text.lines().next()
}
```

This says: if the function returns a line, that line is borrowed from `text` and cannot outlive `text`.

The annotation does not extend `text`. The caller still owns the source string. Rust only checks that the returned slice is not used after the source is gone.

Most functions do not need explicit annotations because Rust applies lifetime elision rules. You write explicit lifetimes when the relationship is not obvious from the common patterns.

## Borrowed Structs

A struct that stores references needs lifetime parameters.

```rust
struct ParsedNote<'a> {
    title: &'a str,
    body: &'a str,
}

fn parse_note(source: &str) -> Option<ParsedNote<'_>> {
    let title = source.lines().next()?.trim_start_matches("# ");
    Some(ParsedNote {
        title,
        body: source,
    })
}
```

`ParsedNote<'a>` means a parsed note borrows from some source that lives for `'a`.

This design can be excellent for parsers because it avoids allocation. It can also make APIs harder to use because the parsed value stays tied to the original source.

Use borrowed structs when the source naturally lives long enough. Return owned structs when the parsed value needs to move around independently.

:::expand[Borrowed structs trade allocation for lifetime coupling]{kind="design"}
Borrowed structs are often attractive because they avoid copying.

```rust
struct ParsedNote<'a> {
    title: &'a str,
    body: &'a str,
}
```

This can be a good parser shape when the caller already owns a large source string and will keep it alive while reading parsed views.

The tradeoff is coupling:

```rust
let source = String::from("# Rust\nbody");
let parsed = parse_note(&source).unwrap();
drop(source);
println!("{}", parsed.title);
```

Rust rejects this because `parsed.title` points into `source`. Dropping `source` would invalidate the parsed view.

An owned version is less efficient but easier to move:

```rust
struct OwnedNote {
    title: String,
    body: String,
}
```

Decision table:

| Need | Better shape |
| --- | --- |
| Fast temporary view into source | Borrowed struct |
| Store parsed value long term | Owned struct |
| Send parsed value to another thread | Usually owned struct |
| Avoid allocation in parser hot path | Borrowed struct |

The advanced part is not the syntax. It is choosing the coupling intentionally.
:::

## Returned References

When a function returns a reference, the returned value must come from somewhere that still exists.

This works:

```rust
fn title<'a>(note: &'a ParsedNote<'a>) -> &'a str {
    note.title
}
```

The returned title is borrowed from the input note.

This cannot work:

```rust
fn make_title() -> &str {
    let title = String::from("temporary");
    &title
}
```

The local `String` is dropped when the function returns. A returned reference would point to cleaned-up data.

The fix is to return owned data:

```rust
fn make_title() -> String {
    String::from("temporary")
}
```

This is the same ownership lesson in lifetime form. References are views into data owned somewhere else. If there is no surviving owner, return an owned value.

## Elision Limits

Lifetime elision lets common signatures stay readable.

This function does not need explicit lifetimes:

```rust
fn first_word(text: &str) -> Option<&str> {
    text.split_whitespace().next()
}
```

There is one input reference, so Rust can infer that the output reference is tied to it.

This is ambiguous:

```rust
fn longer(a: &str, b: &str) -> &str {
    if a.len() >= b.len() { a } else { b }
}
```

The output might come from `a` or `b`, so Rust needs a named relationship:

```rust
fn longer<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}
```

This says the returned reference is valid only as long as both inputs are valid for the shared lifetime.

## Avoiding Over-Borrowed APIs

Lifetimes are powerful, but too many borrowed relationships can make an API awkward.

This kind of design spreads the source lifetime everywhere:

```rust
struct SearchIndex<'a> {
    titles: Vec<&'a str>,
}
```

That may be fine for a temporary index built during parsing. It is a poor fit for a long-lived search index loaded into an app.

An owned design may be better:

```rust
struct SearchIndex {
    titles: Vec<String>,
}
```

The owned index costs allocation, but it can be stored, sent, cached, and used without keeping the original source text alive.

:::expand[If lifetimes spread everywhere, reconsider ownership]{kind="pitfall"}
A common advanced-Rust trap is accepting a lifetime-heavy design because it feels efficient.

The code begins with one borrowed type:

```rust
struct ParsedNote<'a> {
    title: &'a str,
}
```

Then the index borrows parsed notes:

```rust
struct Index<'a> {
    titles: Vec<&'a str>,
}
```

Then the service state borrows the index, tests need source strings kept alive, and every function grows a lifetime parameter.

That may be correct for a parser library. It is probably wrong for an application state object.

Use this review question: does this value represent a temporary view, or does it represent data the application owns?

Temporary views can borrow. Application state usually owns. The allocation cost of `String` is often cheaper than making the whole program carry a source lifetime it does not really want.
:::

## Putting It All Together

A parser can expose both shapes:

```rust
struct ParsedNote<'a> {
    title: &'a str,
    body: &'a str,
}

struct OwnedNote {
    title: String,
    body: String,
}

fn parse_view(source: &str) -> Option<ParsedNote<'_>> {
    let title = source.lines().next()?.trim_start_matches("# ");
    Some(ParsedNote {
        title,
        body: source,
    })
}

fn parse_owned(source: &str) -> Option<OwnedNote> {
    let view = parse_view(source)?;
    Some(OwnedNote {
        title: view.title.to_string(),
        body: view.body.to_string(),
    })
}
```

The borrowed parser is efficient for temporary work. The owned parser gives the application a value it can store freely.

Count back to the opener:

- Lifetimes describe relationships between references.
- Borrowed structs tie values to their source.
- Returned references must come from surviving data.
- Owned values are often clearer at long-lived boundaries.

## What's Next

The next submodule moves from advanced safe abstractions into code generation and boundary work. First up: macros, the Rust tool for generating repetitive code at compile time.

---

**References**

- [Validating References with Lifetimes - The Rust Programming Language](https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html)
- [Lifetime elision - Rust Reference](https://doc.rust-lang.org/reference/lifetime-elision.html)
