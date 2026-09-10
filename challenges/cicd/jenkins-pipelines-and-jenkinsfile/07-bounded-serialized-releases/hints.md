Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

The current job has neither concurrency control nor a bounded validation stage. A second build can overlap a release, or hold an executor indefinitely.

---

Serialize this job's builds, bound validation to 40 seconds, and clean its workspace even after timeout. Validate/build once and transfer the application into a later trusted staging deployment.
