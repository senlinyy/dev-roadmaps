---
title: "Extract Fields from a Simple Export"
sectionSlug: when-should-you-use-line-tools-structured-tools-or-another-interface
order: 2
---

Support needs the city column from a pipe-delimited user export. Names contain spaces, so whitespace splitting would move the fields. This export has no header, quoted delimiters, or multiline records; it is not a general CSV-parsing task.

You start in `/home/dev`. Read `/home/dev/exports/users.txt`; each record is `id|name|city`.

Your job:

1. Inspect the first two records before choosing the delimiter.
2. Print only the city field for every record, preserving source order and duplicates.
3. Print the ID and city fields together, retaining the pipe between them.
4. Keep the export unchanged.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
