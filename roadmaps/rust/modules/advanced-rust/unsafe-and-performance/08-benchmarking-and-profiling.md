---
title: "Benchmarking And Profiling"
description: "Measure Rust performance with release builds, cargo bench, Criterion, profiling, allocation awareness, and evidence-driven optimization."
overview: "Advanced Rust performance work should begin with measurement. Benchmarks and profiles tell you whether the bottleneck is parsing, allocation, I/O, synchronization, or something else."
tags: ["benchmarking", "profiling", "performance", "criterion"]
order: 4
id: article-rust-advanced-rust-benchmarking-and-profiling
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Release Builds](#release-builds)
3. [Benchmarks](#benchmarks)
4. [Criterion](#criterion)
5. [Profiling](#profiling)
6. [Common Bottlenecks](#common-bottlenecks)
7. [Putting It All Together](#putting-it-all-together)

## The Problem

The notes indexer feels slow on a large folder. Someone suggests unsafe pointer code. Someone else suggests async. Another person suggests more threads.

Those might be useful, or they might be distractions.

Performance work needs evidence:

- Is the program slow in parsing, file I/O, allocation, sorting, locking, or JSON output?
- Does the slow path appear in release builds?
- Does an optimization actually improve the measured workload?

Rust gives you low-level control, but control without measurement is just guessing with sharper tools.

## Release Builds

Always measure optimized builds.

```bash
cargo build --release
```

Debug builds are designed for fast compilation and good debugging. They do not represent production performance.

For quick manual checks:

```bash
cargo run --release -- index ./notes
```

This still is not a proper benchmark, but it prevents one common mistake: making performance decisions from debug-mode behavior.

## Benchmarks

Benchmarks isolate a workload and measure it repeatedly.

Cargo has a benchmark command:

```bash
cargo bench
```

For serious microbenchmarks, many Rust projects use Criterion because it provides statistical measurement and useful reports.

The important habit is to benchmark the behavior you plan to improve.

```rust
fn parse_titles(input: &str) -> Vec<&str> {
    input
        .lines()
        .filter_map(|line| line.strip_prefix("# "))
        .collect()
}
```

If title parsing is the suspected hot path, benchmark that function with representative input. Do not benchmark a toy string and assume the result applies to a 50 MB notes folder.

:::expand[Benchmark the question you actually care about]{kind="pattern"}
A benchmark can be technically correct and still answer the wrong question.

Weak benchmark:

```text
Parse one tiny note title 10 million times.
```

That may measure function-call overhead or branch prediction more than real indexer behavior.

Better benchmark:

```text
Parse a representative markdown file with many headings, links, tags, and blank lines.
```

Better still:

```text
Benchmark the parser alone and benchmark the full indexing pipeline separately.
```

Use a ladder:

| Benchmark | Answers |
| --- | --- |
| Microbenchmark | Is this small function expensive? |
| Component benchmark | Is this parser/indexer stage expensive? |
| End-to-end benchmark | Did the whole user-facing workflow improve? |

Performance work goes wrong when a microbenchmark improves but the real workflow does not. Keep at least one benchmark close to the actual user path.
:::

## Criterion

Criterion is a statistics-driven Rust benchmarking library.

A typical benchmark lives under `benches/`:

```text
benches/
  parse_titles.rs
```

The benchmark body names the operation:

```rust
use criterion::{criterion_group, criterion_main, Criterion};

fn bench_parse_titles(c: &mut Criterion) {
    let input = include_str!("../fixtures/large-note.md");

    c.bench_function("parse titles", |b| {
        b.iter(|| parse_titles(input))
    });
}

criterion_group!(benches, bench_parse_titles);
criterion_main!(benches);
```

Criterion repeatedly runs the function and reports timing with statistical context. That helps separate real changes from noise.

## Profiling

A benchmark tells you whether something is slow. A profiler helps show where time goes.

Depending on the platform, you might use tools such as `perf`, Instruments, samply, flamegraph tools, or operating-system profilers.

The workflow is:

1. Reproduce the slow workload.
2. Build in release mode with useful debug symbols if needed.
3. Record a profile.
4. Look for the hot functions or allocation-heavy paths.
5. Change one thing.
6. Measure again.

Profiling often reveals surprises. The parser may be fine while sorting dominates. A clone may allocate far more than expected. A mutex may serialize work. A logging call may be louder than the code it describes.

## Common Bottlenecks

Rust performance problems often come from ordinary design choices.

| Symptom | Possible cause |
| --- | --- |
| Many allocations | Repeated `String` creation, unnecessary clones |
| Low CPU use with long runtime | I/O waiting, locking, or serial bottleneck |
| High CPU in parsing | Inefficient scanning or repeated work |
| Slow multithreaded version | Lock contention or too-small work chunks |
| Faster microbenchmark, same app speed | Optimized the wrong path |

Start with simple fixes: borrow instead of clone, reuse buffers, avoid repeated parsing, choose better collection shapes, reduce lock scope, batch I/O carefully.

Unsafe code should be late in the process, after safe design and measurement show a narrow reason.

## Putting It All Together

The notes indexer can use an evidence loop:

```text
1. Run the full indexer in release mode.
2. Benchmark parser and index stages separately.
3. Profile the full workload.
4. Identify the biggest bottleneck.
5. Make one focused change.
6. Re-run the same benchmark.
```

Count back to the opener:

- Async helps waiting work, not CPU parsing by itself.
- Threads help only if work can run in parallel without contention.
- Unsafe needs a measured reason and a small invariant.
- Benchmarks and profiles decide what deserves attention.

This is a good ending for Advanced Rust because it keeps the whole module grounded. Smart pointers, trait objects, macros, unsafe, and FFI are tools. Measurement tells you when the performance tools are worth their complexity.

---

**References**

- [cargo bench - The Cargo Book](https://doc.rust-lang.org/cargo/commands/cargo-bench.html)
- [Criterion crate documentation](https://docs.rs/criterion/latest/criterion/)
- [Criterion.rs User Guide](https://bheisler.github.io/criterion.rs/book/)
- [The Rust Performance Book](https://nnethercote.github.io/perf-book/)
