---
title: "Wire an Implicit Dependency"
sectionSlug: implicit-dependencies-from-references
order: 1
revision: 2
---

The function currently repeats a role ARN as a string, which hides the ownership relationship from Terraform. Connect the function to the managed role so the graph follows the real data flow.

Your job:

1. **Keep** `aws_iam_role.orders_runtime` as the role owner.
2. **Set** the Lambda function role from `aws_iam_role.orders_runtime.arn`.
3. **Set** the function name from `local.function_name`.
4. **Do** not add `depends_on` for a relationship already expressed by an attribute reference.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
