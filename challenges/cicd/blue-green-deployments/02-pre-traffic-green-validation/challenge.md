---
title: "Validate Green Before the Switch"
sectionSlug: testing-green-before-users-reach-it
order: 2
---

The validation job accidentally tests the public URL before the switch. In a blue-green deployment, that means it is testing blue while claiming to test green.

Your task:

1. **Point the validation URL** at the test listener for green.
2. **Keep the expected task definition** as `orders-api:42`.
3. **Run readiness, version, and checkout smoke checks** against the test listener.

The grader checks that the validation job targets the test listener and proves the green task definition.

