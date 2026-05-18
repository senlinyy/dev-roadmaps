~~~rust
mod parser;
mod model;

pub use parser::count_words;
pub use model::Note;
~~~

The modules organize the implementation, while the re-exports define the public paths external callers use.
