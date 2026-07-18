---
title: "Require the Orders Ownership Label"
sectionSlug: validatingadmissionpolicy-with-cel
order: 1
---

The platform team wants ownership evidence on new Pods, but enforcement must begin as a scoped warning. Complete the policy and binding so the rule is precise and the rollout cannot block unrelated namespaces.

Your job:

1. **Match Pod create and update requests** in the core `v1` API.
2. **Require label `app.kubernetes.io/part-of`** with a CEL expression and return message `Pods must include app.kubernetes.io/part-of`.
3. **Bind policy `require-app-owner-label`** to namespace label `kubernetes.io/metadata.name: orders`.
4. **Use only action `Warn`** for this first rollout.

The grader checks the policy and binding as separate parsed resources, including exact rule and action list sizes.
