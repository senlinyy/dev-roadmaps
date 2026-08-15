---
title: "Define and Validate Deployment Inputs"
sectionSlug: validation-defaults-and-sensitive-inputs
order: 1
revision: 2
---

The service module accepts an environment and replica count from callers. Give those inputs explicit contracts so an invalid production shape fails before provider operations begin.

Your job:

1. **Define** string variable `environment` with default `dev` and validation that accepts only `dev`, `staging`, or `prod`.
2. **Define** number variable `replica_count` with default `2` and validation requiring a value from 1 through 10.
3. **Use** both variables in `aws_ecs_service.orders` for its name and desired count.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
