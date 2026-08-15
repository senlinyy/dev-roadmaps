All three resources are namespaced. Start by adding namespace `orders` to each metadata block, then build the two Role rules.

---

Build a separate core API rule for Pod evidence. The rollout rule needs read verbs plus the two update verbs, while the core rule contains only `pods` and read verbs.

---

The RoleBinding uses `roleRef` for the Role and a one-item `subjects` list for the ServiceAccount. Both references use the name `orders-release`.
