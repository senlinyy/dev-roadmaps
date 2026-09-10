Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

Feedback is slower than necessary. Starting packaging alongside the checks would be faster but could release an unvalidated build.

---

Give lint and unit tests independent parallel stage allocations and their own locked installations. Publish unit reports on failure, join both branches, then build/archive only after the join succeeds.
