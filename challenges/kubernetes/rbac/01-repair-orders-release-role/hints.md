Add the Role's namespace scope before building its permission list. Keep workload resources from the `apps` API group together in one rule.

---

Build a separate core API rule for Pod evidence. The rollout rule needs read verbs plus the two update verbs, while the core rule contains only `pods` and read verbs.
