Open the producer's workspace, then the consumer's. Is the missing file absent from the build entirely, or only from the worker that needs it?

---

Job dependencies establish ordering, not file transfer. Inspect whether the run retained an artifact and whether the consumer retrieved it at the required path.

---

The handoff needs a validated producer, an uploaded output, a dependent download, and verification of those bytes. Use failure cases to check that no consumer work proceeds after an invalid or failed build.
