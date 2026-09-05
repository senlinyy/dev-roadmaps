Inspect the worker's inherited-file and process counts before the first operation.

---

A new checkout does not delete every generated file or stop old processes.

---

Prepare the persistent worker before setup and use finally for teardown; keep checkout source files outside generated-file cleanup.
