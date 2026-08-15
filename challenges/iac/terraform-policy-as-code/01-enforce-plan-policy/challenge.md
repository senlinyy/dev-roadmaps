---
title: "Enforce Required Tags and Protected Deletes"
sectionSlug: opa-rules-for-required-tags
order: 1
revision: 2
---

The platform pipeline converts a saved Terraform plan to JSON and evaluates OPA before apply. Complete the policy so managed AWS resources need ownership tags and protected production resources cannot be deleted.

Your job:

1. **Use** package `terraform.policy`.
2. **Implement** `deny` over `input.resource_changes` for managed resources whose `change.after.tags` lacks `Owner` or `Environment`.
3. **Implement** `deny_delete` for resources with `change.actions == ["delete"]` and `change.before.tags.Environment == "prod"`.
4. **Return** a clear message from each rule.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
