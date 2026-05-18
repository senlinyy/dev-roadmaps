The text fields should be String, not &str, because the struct owns its data.
---
The boolean field should be named pinned.
---
Use String::from("...") when constructing the note.
