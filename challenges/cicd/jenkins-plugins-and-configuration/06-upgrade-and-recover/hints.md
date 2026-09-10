Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

The plan restarts without a backup and promotes without representative testing. Reusing an old image alone would not prove recovery.

---

Prepare the lab-core-2/lab-2 candidate. Back up the previous image/config/state, build and boot, smoke-test, and promote only when healthy. Add conditional restore after that path; it executes only when an earlier operation failed.
