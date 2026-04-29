---
title: "Scope a Deployment to an Environment"
sectionSlug: environments-scoping-secrets-to-stages
order: 1
---

Your team runs separate AWS accounts for staging and production. The deploy workflow currently uses repository-level secrets, which means every job has access to both sets of credentials. You need to isolate the production deployment so it can only access production-scoped secrets.

Your task:

1. **Associate the production deploy job** with a named GitHub environment so its secrets are scoped.
2. **Add environment association** to the staging deploy job as well, using a different environment name.

The grader checks that both deploy jobs are associated with distinct named environments.
