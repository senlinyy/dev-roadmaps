Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

When tests return a failure, Jenkins stops normal steps before publication and cleanup. The failed run loses the evidence needed to diagnose it.

---

Move reliable finalization into stage post behavior. Run lint and unit tests, build/archive only a healthy application, publish the generated XML on both result paths, and clean only after reporting.
