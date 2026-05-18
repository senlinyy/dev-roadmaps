Private modules use mod parser; and mod model;, not pub mod.
---
pub use parser::count_words; exposes the function at the crate root.
---
pub use model::Note; exposes the type at the crate root.
