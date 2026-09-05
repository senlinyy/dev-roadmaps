Compare the unit-only recipe with the environment and check contracts.

---

Starting a service is not readiness; later integration work needs both isolation and an observed ready condition.

---

Use a bounded wait before validation, and put teardown in finally so a failing check does not skip it.
