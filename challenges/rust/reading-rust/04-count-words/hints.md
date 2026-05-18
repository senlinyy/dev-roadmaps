&str means the function borrows text; it does not need to allocate a new String.
---
The article uses text.split_whitespace().count().
---
count() returns usize, which matches the function return type.
