---
title: "Install a Missing System Dependency"
sectionSlug: the-operational-spine-the-missing-dependency
order: 1
---

A Python build is failing on `ubuntu-latest` because the `psycopg2` library needs a C extension that is not pre-installed on the runner. The build log shows `pg_config executable not found`.

Your task:

1. **Add a new step** before the `pip install` step that installs the missing system-level package using the runner's package manager.
2. **Ensure the package manager index is updated** before installation so the package can be found.

The grader checks that your workflow contains a step with an `apt-get install` command positioned before the pip install step.
