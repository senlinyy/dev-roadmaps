---
title: "Install a Missing System Dependency"
sectionSlug: installing-system-dependencies
order: 1
---

A Python build is failing on `ubuntu-latest` because the `psycopg2` library needs the `libpq-dev` system package before pip can compile its C extension. The build log shows `pg_config executable not found`.

Your task:

1. **Add a new step** before the `pip install` step that installs `libpq-dev` using the runner's package manager.
2. **Ensure the package manager index is updated** before installation so the package can be found.

The grader checks that your workflow contains a step with an `apt-get install` command positioned before the pip install step.
