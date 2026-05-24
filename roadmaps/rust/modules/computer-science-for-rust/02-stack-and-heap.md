---
title: "Stack And Heap"
description: "Understand the memory shapes behind Rust values, including stack frames, heap allocations, String, Vec, references, moves, copies, Box, and cleanup."
overview: "Rust ownership is easier when you can picture where values live. This article follows small values, owned strings, vectors, references, and boxed values through memory in beginner-friendly terms."
tags: ["stack", "heap", "pointers", "ownership"]
order: 2
id: article-rust-computer-science-for-rust-stack-heap-pointers
aliases:
  - stack-heap-and-pointers
  - computer-science-for-rust/02-stack-and-heap.md
  - computer-science-for-rust/02-stack-heap-and-pointers.md
  - computer-science-for-rust/execution-basics/02-stack-and-heap.md
  - roadmaps/rust/modules/computer-science-for-rust/02-stack-heap-and-pointers.md
  - roadmaps/rust/modules/computer-science-for-rust/execution-basics/02-stack-and-heap.md
  - child-computer-science-for-rust-02-stack-heap-and-pointers
  - child-execution-basics-02-stack-and-heap
---

## Table of Contents

1. [What Is Program Memory?](#what-is-program-memory)
2. [The Stack](#the-stack)
3. [The Heap](#the-heap)
4. [String and Vec](#string-and-vec)
5. [Moves and Copies](#moves-and-copies)
6. [References](#references)
7. [Box](#box)
8. [Memory Bugs Rust Prevents Early](#memory-bugs-rust-prevents-early)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is Program Memory?

The previous article followed a Rust program as a running process: Cargo built a binary, the operating system started it, `main` ran, functions called other functions, scopes ended, and the process exited. This article looks at the values created during that run.

Program memory is the part of a process where data lives while the program is running. Some values are small and predictable enough to live directly in a function's stack frame. Other values need storage whose size is chosen while the program runs, so they use the heap.

Start with a tiny project:

```bash
$ cargo new memory-notes
    Creating binary (application) `memory-notes` package
$ cd memory-notes
```

Put this in `src/main.rs`:

```rust
fn main() {
    let count = 3;
    let title = String::from("Deploy notes");

    println!("{count}: {title}");
}
```

Run it:

```bash
$ cargo run
   Compiling memory-notes v0.1.0 (/home/you/memory-notes)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.25s
     Running `target/debug/memory-notes`
3: Deploy notes
```

The output comes from two local bindings, `count` and `title`. They look similar in source code because both names are local to `main`, but they do not have the same memory shape.

`count` is an integer. Its value fits directly in `main`'s stack frame. `title` is a `String`. The `String` value in the stack frame is a small handle that points to text bytes stored on the heap.

```text
main stack frame
+-- count: 3
+-- title: String handle
    +-- pointer --------+
    +-- length: 12      |
    +-- capacity: 12    |
                        v
heap allocation
+-- bytes: Deploy notes
```

The diagram is simplified, but it shows the important shape. A local binding can store a complete small value, or it can store a handle to storage somewhere else. Rust's ownership rules track who is responsible for those handles and the allocations behind them.

## The Stack

The stack is memory used for active function calls. Each function call gets a stack frame. When the function returns, its frame is removed.

Use a program where the values are small:

```rust
fn add_tax(price: u32) -> u32 {
    let tax = 2;
    price + tax
}

fn main() {
    let subtotal = 40;
    let total = add_tax(subtotal);

    println!("{total}");
}
```

Run it:

```bash
$ cargo run
42
```

At the moment `add_tax` is running, the active stack frames can be pictured like this:

```text
stack
+--------------------------+
| add_tax                  |
| price: 40                |
| tax: 2                   |
+--------------------------+
+--------------------------+
| main                     |
| subtotal: 40             |
| total: waiting for value |
+--------------------------+
```

`main` is still active because it called `add_tax` and is waiting for a result. `add_tax` has its own parameter, `price`, and its own local binding, `tax`. When `add_tax` returns `42`, its frame is removed and `main` stores the result in `total`.

This is why stack allocation is fast. The program follows a simple order: enter a function, reserve room for its frame, run the function, then remove the frame. The program does not search the whole heap to store `tax`. The current function frame already has room for it.

The tradeoff is that stack values need a size the compiler can know. A `u32` always has the same size. A `bool` always has the same size. A struct made from fixed-size fields has a known size. A list that grows from 3 items to 3000 items while the program runs needs a different shape.

## The Heap

The heap is memory used for data whose size or lifetime does not fit neatly inside one stack frame. A `String` can grow while the program runs. A `Vec<T>` can hold a changing number of elements. Those values use heap allocations for their contents.

Change `src/main.rs` to inspect a `String`:

```rust
fn main() {
    let mut title = String::from("Deploy");

    println!("before: len={}, cap={}", title.len(), title.capacity());

    title.push_str(" notes");

    println!("after:  len={}, cap={}", title.len(), title.capacity());
    println!("{title}");
}
```

A possible run is:

```bash
$ cargo run
before: len=6, cap=6
after:  len=12, cap=12
Deploy notes
```

`len` is the number of bytes currently used by the string. `cap`, short for capacity, is the number of bytes the string can hold before it must ask the allocator for a larger heap allocation. The exact capacity can vary by platform, compiler version, and allocation history. The meaning of the fields is stable.

This is similar to filesystem commands that show both used space and available space. A string has current contents and reserved room. When the reserved room is not enough, the string may allocate a larger buffer, copy the existing bytes, and update its handle.

The stack frame still holds the `String` handle:

```text
main stack frame
+-- title: String
    +-- pointer
    +-- length
    +-- capacity

heap allocation
+-- bytes for the text
```

The heap allocation holds the bytes. The handle tells Rust where those bytes are, how many bytes are valid text, and how much room is reserved.

## String and Vec

`String` and `Vec<T>` are common because real programs work with text and growable lists. They have similar memory shapes: a small handle on the stack and storage on the heap.

Here is a vector example:

```rust
fn main() {
    let mut notes = Vec::new();

    println!("before: len={}, cap={}", notes.len(), notes.capacity());

    notes.push(String::from("Deploy notes"));
    notes.push(String::from("Fix login"));

    println!("after:  len={}, cap={}", notes.len(), notes.capacity());

    for note in &notes {
        println!("{note}");
    }
}
```

A possible run is:

```bash
$ cargo run
before: len=0, cap=0
after:  len=2, cap=4
Deploy notes
Fix login
```

The vector starts empty, so its length is `0`. After two pushes, the length is `2`. The capacity might be `4` because vectors commonly reserve extra room so every push does not require a fresh allocation. The precise capacity is an implementation detail. The field still teaches the storage idea: length is how many elements are present, and capacity is how many can fit before growing.

There are two heap layers in this example:

```text
main stack frame
+-- notes: Vec<String> handle
    +-- pointer --------------+
    +-- length: 2             |
    +-- capacity: 4           |
                              v
heap allocation for vector elements
+-- String handle for "Deploy notes" --> heap bytes
+-- String handle for "Fix login" ----> heap bytes
```

The vector owns its elements. Each element is a `String` handle. Each `String` handle owns text bytes. This layered shape is why Rust is strict about moves: copying a handle casually can create confusion about who must clean up the heap allocation.

## Moves and Copies

Assignment in Rust either copies a value or moves it. The difference depends on the type.

Small fixed-size values such as integers implement `Copy`, so this works:

```rust
fn main() {
    let a = 3;
    let b = a;

    println!("a={a}, b={b}");
}
```

Run it:

```bash
$ cargo run
a=3, b=3
```

The integer value was copied. Both names remain usable because there is no heap allocation or special cleanup responsibility behind a plain integer.

A `String` behaves differently:

```rust
fn main() {
    let first = String::from("Deploy notes");
    let second = first;

    println!("{first}");
    println!("{second}");
}
```

Check it:

```text
$ cargo check
    Checking memory-notes v0.1.0 (/home/you/memory-notes)
error[E0382]: borrow of moved value: `first`
 --> src/main.rs:5:15
  |
2 |     let first = String::from("Deploy notes");
  |         ----- move occurs because `first` has type `String`, which does not implement the `Copy` trait
3 |     let second = first;
  |                  ----- value moved here
5 |     println!("{first}");
  |               ^^^^^^^ value borrowed here after move
```

The assignment `let second = first;` moves the `String` handle. After that line, `second` owns the handle and the heap allocation behind it. Rust will not let `first` keep acting like an owner.

The output names the reason: `String` does not implement the `Copy` trait. A trait is a named capability a type can implement. `Copy` means a value can be duplicated by a simple bitwise copy and both copies remain valid.

For an integer, the bits are the whole value:

```text
a stack slot: 00000000 00000000 00000000 00000011
b stack slot: 00000000 00000000 00000000 00000011
```

There is no separate allocation behind those bits. When `a` and `b` go out of scope, there is no heap memory to free.

For a `String`, the stack bits are a handle:

```text
first String handle
+------------------+
| pointer ---------+----> heap bytes "Deploy notes"
| length: 12       |
| capacity: 12     |
+------------------+
```

A bitwise copy of that handle would create another handle with the same pointer, length, and capacity:

```text
first.pointer  -> same heap bytes
second.pointer -> same heap bytes
```

That would not create a second copy of the text. It would create two owners that both believe they should free the same allocation. Rust solves the problem by moving the handle instead. After `let second = first;`, `second` owns the handle and `first` is no longer a valid `String` binding. The heap bytes stay in place, and only one owner remains responsible for cleanup.

If you really want another owned string, clone it:

```rust
fn main() {
    let first = String::from("Deploy notes");
    let second = first.clone();

    println!("{first}");
    println!("{second}");
}
```

Run it:

```bash
$ cargo run
Deploy notes
Deploy notes
```

`clone` makes a new owned value. For `String`, that means allocating another heap buffer and copying the text bytes. Cloning is sometimes correct, but it is real work, so Rust makes it visible in the source code.

## References

A reference lets code use a value without taking ownership of it. The most common reference forms are `&T` for shared access and `&mut T` for mutable access.

This function borrows a string slice:

```rust
fn print_title(title: &str) {
    println!("title: {title}");
}

fn main() {
    let title = String::from("Deploy notes");

    print_title(&title);
    println!("still owned by main: {title}");
}
```

Run it:

```bash
$ cargo run
title: Deploy notes
still owned by main: Deploy notes
```

The call `print_title(&title)` passes a reference. The function can read the title, but it does not own the `String`. After the call returns, `main` still owns the value and can print it again.

Conceptually, the reference is another small value. It points at the string data for the duration of the call:

```text
main stack frame
+-- title: String handle -----> heap bytes "Deploy notes"

print_title stack frame
+-- title: &str --------------> same text bytes
```

The reference does not contain the text bytes, and it does not contain the cleanup responsibility. It is a temporary way to reach data owned somewhere else. When `print_title` returns, its stack frame is removed, the reference disappears, and the original `String` in `main` remains the owner.

A mutable reference lets a function change a value it does not own:

```rust
fn add_suffix(title: &mut String) {
    title.push_str("!");
}

fn main() {
    let mut title = String::from("Deploy notes");

    add_suffix(&mut title);

    println!("{title}");
}
```

The output is:

```text
Deploy notes!
```

The `mut` on `let mut title` says the binding can be changed. The `&mut title` at the call site says the function gets exclusive mutable access for the duration of the call. Rust's borrowing rules use that exclusivity to prevent accidental simultaneous reads and writes that would make memory behavior unclear.

## Box

`Box<T>` stores a value on the heap and keeps a fixed-size owning pointer on the stack. A boxed value still has one owner. The difference is where the owned data lives.

```rust
fn main() {
    let boxed = Box::new(42);

    println!("{boxed}");
}
```

Run it:

```bash
$ cargo run
42
```

For an integer this example is intentionally simple. Boxing one `i32` is usually unnecessary. The useful lesson is the shape:

```text
main stack frame
+-- boxed: Box<i32> -----> heap allocation
                           +-- 42
```

`Box` becomes useful when a value needs a stable heap location, when a type would otherwise be too large to move around comfortably, or when a recursive type needs indirection. A recursive type is a type that contains another value of the same type. Without a pointer-like layer, the compiler could not know its size.

Here is a small recursive list:

```rust
enum List {
    Node(i32, Box<List>),
    End,
}

fn main() {
    let list = List::Node(1, Box::new(List::Node(2, Box::new(List::End))));

    match list {
        List::Node(value, _) => println!("first value: {value}"),
        List::End => println!("empty"),
    }
}
```

The output is:

```text
first value: 1
```

The `Box<List>` field gives each node a pointer-sized field instead of embedding another full `List` directly inside itself forever. That indirection lets the compiler know the size of `List`.

The size problem is worth spelling out. If a list node stored another `List` directly, the compiler would ask how big one `List` is:

```text
List
  = tag for Node or End
  + i32
  + another full List
      = tag for Node or End
      + i32
      + another full List
          ...
```

That definition never reaches a fixed size. With `Box<List>`, the node stores a pointer-sized owner instead of the next node itself:

```text
List::Node
  = tag for Node
  + i32
  + Box<List> pointer
```

The next node lives on the heap. The current node only needs room for the box handle, whose size is known. Ownership still stays clear: each `Box` owns the next `List` node and drops it when the owning node is dropped.

## Memory Bugs Rust Prevents Early

Rust's memory model is strict because it is trying to reject common memory bugs before the program runs.

| Bug shape | What goes wrong | Rust pressure |
| --- | --- | --- |
| Use after free | Code reads memory after it has been released. | Ownership and lifetimes prevent references from outliving owners. |
| Double free | Two owners both try to release the same allocation. | Moving a non-`Copy` value invalidates the old owner. |
| Dangling pointer | A pointer still points at data that no longer exists. | Borrow checking ties references to valid scopes. |
| Data race | Threads read and write shared memory without coordination. | Shared mutation across threads requires synchronization types. |

These rules can feel strict in small examples. Their value appears when programs grow. The compiler is checking the same kinds of ownership and lifetime facts a careful C or C++ programmer would need to reason about manually.

The key beginner move is to connect the error message back to the memory shape. If Rust says a `String` was moved, picture the handle moving to a new owner. If Rust says a reference does not live long enough, picture a pointer trying to outlast the data it points to. If Rust asks for `&mut`, picture exclusive access to one value for a limited time.

## Putting It All Together

The `memory-notes` examples showed the storage layer beneath Rust code:

- Stack frames hold active function calls, parameters, and local values with known sizes.
- The heap holds data that grows or needs indirection while the program runs.
- `String` and `Vec<T>` store small handles on the stack and contents on the heap.
- Length and capacity expose the difference between used space and reserved space.
- Assignment copies small `Copy` values but moves ownership for values such as `String`.
- References let functions read or change values without becoming owners.
- `Box<T>` gives one owner a heap allocation through a pointer-sized handle.

Rust's ownership rules are easier to accept when they are attached to this picture. The compiler is not protecting words in a file. It is protecting real allocations, references, and cleanup paths in a running process.

## What's Next

Memory stores bytes. The next article asks how Rust gives those bytes meaning. You will look at bits, integer types, text, structs, enums, `Option`, and `Result`.

---

**References**

- [The Rust Programming Language: What Is Ownership?](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html) - Explains stack and heap memory in the context of ownership.
- [The Rust Programming Language: References and Borrowing](https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html) - Covers shared and mutable references.
- [std::string::String](https://doc.rust-lang.org/std/string/struct.String.html) - Documents owned growable UTF-8 strings, length, and capacity.
- [std::vec::Vec](https://doc.rust-lang.org/std/vec/struct.Vec.html) - Documents growable vectors, length, capacity, and allocation behavior.
- [std::boxed::Box](https://doc.rust-lang.org/std/boxed/struct.Box.html) - Documents heap allocation through `Box<T>`.
