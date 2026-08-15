1. Use blockinfile because the team owns a multi-line region, not the whole file.
2. Stable markers make repeated runs update the same region.
3. Validation receives the candidate path through `%s`.
