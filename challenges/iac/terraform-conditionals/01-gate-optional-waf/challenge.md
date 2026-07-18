---
title: "Gate the Optional WAF"
sectionSlug: creating-an-optional-resource
order: 1
---

The shared load balancer module must attach a WAF only in environments that explicitly enable it. Complete the variable contract and optional association without duplicating the resource.

Your job:

1. **Declare `enable_waf` as a boolean** with a default of `false`.
2. **Declare `waf_acl_arn` as a nullable string** with a default of `null`.
3. **Create one association only when WAF is enabled** through a conditional `count`.
4. **Use the supplied load balancer ARN and WAF ARN** in the association.

The grader checks the variable types/defaults and the conditional resource wiring.
