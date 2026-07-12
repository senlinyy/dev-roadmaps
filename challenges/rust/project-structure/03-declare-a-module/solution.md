~~~rust
pub mod parser;

pub fn count_words(text: &str) -> usize {
    parser::words(text).len()
}
~~~
