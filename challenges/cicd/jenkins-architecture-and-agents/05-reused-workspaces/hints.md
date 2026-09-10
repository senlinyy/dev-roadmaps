Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

Identical application revisions now behave differently depending on which worker accepts the build. End-only cleanup also disappears when a test fails.

---

Repair the workspace lifecycle in Jenkinsfile: begin from clean state, explicitly check out the scheduled revision, validate and build, archive the output, publish test evidence, and clean the allocation after either result.
