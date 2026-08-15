---
title: "Initialize and Review a Plan"
sectionSlug: plan-and-apply-are-the-change-loop
order: 1
revision: 2
---

A teammate has handed you a small orders bucket configuration in `/workspace`. Establish the local Terraform working data and produce the first change preview without applying it.

Your job:

1. **Initialize** the project so its provider selection and working directory are ready.
2. **Generate** a plan and confirm it proposes one create with no changes or destroys.
3. **Stop** at the review boundary without applying infrastructure.

The grader checks the command workflow and resulting Terraform state, not a prose explanation.
