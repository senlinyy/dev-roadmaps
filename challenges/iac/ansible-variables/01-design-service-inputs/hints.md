1. Put broadly safe values in `group_vars/all.yml`.
2. Override only production-specific values in the production group file.
3. Use the `mandatory` filter for an input that has no safe fallback.
