In the lint-failure and test-failure cases, check whether the failing operation appears at all. A green packaging job is not evidence that either check ran.

---

Steps share a job's workspace; jobs do not. Moving packaging to a dependent worker changes ordering, but that worker still needs its own repository and dependencies.

---

Put the validation checks before the packaging boundary. Use the graph to make packaging depend on their success, then confirm it is skipped in both failing cases.
