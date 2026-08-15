---
title: "Create Stable Named Queue Instances"
sectionSlug: for_each-for-named-items
order: 1
revision: 2
---

The orders service needs queues for `created`, `paid`, and `failed` events. Use stable string keys so adding a fourth event later does not renumber the existing resource addresses.

Your job:

1. **Declare** variable `event_types` as `set(string)` with the three required defaults.
2. **Set** `for_each` on `aws_sqs_queue.events` from the variable.
3. **Build** each queue name as `orders-${each.key}`.
4. **Tag** each queue with EventType from `each.key` and Service `orders`.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
