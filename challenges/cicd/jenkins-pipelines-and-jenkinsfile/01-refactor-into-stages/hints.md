Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

A green package is currently possible without lint or tests, and the single stage hides the boundary between validation and packaging.

---

Restructure Jenkinsfile into a validation stage and a later application-build stage. Use the same global Node allocation, perform a locked install, run both checks, and archive only the passing build.
