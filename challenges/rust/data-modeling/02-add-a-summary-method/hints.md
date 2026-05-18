Methods live inside impl Note { ... }.
---
&self lets the method read the note without taking it away from the caller.
---
self.body.len() returns the body length in bytes, which is fine for this ASCII test.
