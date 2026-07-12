~~~rust
mod parser;

pub use parser::count_words;
~~~

- In `src/parser.rs`:

~~~rust
pub fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}
~~~
