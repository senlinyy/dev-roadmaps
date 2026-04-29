---
title: "Restrict GITHUB_TOKEN Permissions"
sectionSlug: the-built-in-github_token
order: 3
---

Your team follows the principle of least privilege. A new workflow job needs to post automated comments on Pull Requests with test coverage results. By default, the GITHUB_TOKEN may have broader permissions than necessary.

Your task:

1. **Declare an explicit permissions block** on the job so it only gets the access it needs.
2. **Grant write access** to the scope that controls PR interactions (comments, reviews, labels).
3. **Grant read access** to the scope that controls code checkout.

The grader validates that the permissions block exists with the correct scope-to-access-level mapping.
