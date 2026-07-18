---
title: "Gate Restart on Validation"
sectionSlug: validation-before-service-changes
order: 1
---

The orders service restart currently runs even when its configuration validator fails. Capture the validator result without letting Ansible stop immediately, then restart only on hosts whose validation returned exit code zero.

Your job:

1. **Run the existing validation command** without reporting a configuration change.
2. **Register its result** as `orders_config_check` and preserve the nonzero return code for the next task to inspect.
3. **Gate the service restart** on `orders_config_check.rc == 0`.
4. **Keep the restart target** as `devpolaris-orders-api`.

The grader checks the two-task relationship and the host-local registered result condition.
