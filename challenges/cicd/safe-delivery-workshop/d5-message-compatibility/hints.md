Start with the supplied evidence and identify the resource or process that actually owns the failing operation.

---

At-least-once delivery requires idempotency at the business effect, not just in memory. Recording the event and inserting the order in one database transaction closes the crash gap between them.

---

Use the success criteria to test both the healthy path and the rejected or failed path. Preserve the source, artifact and identity boundaries when choosing an alternative solution.
