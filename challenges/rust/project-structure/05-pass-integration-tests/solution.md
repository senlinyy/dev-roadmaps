In `src/lib.rs`:

~~~rust
mod parser;

pub use parser::count_words;
~~~

In `src/parser.rs`:

~~~rust
pub fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}
~~~

The integration test can only use public API, so the crate root re-export is what makes the parser behavior reachable.
