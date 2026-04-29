---
title: "Fix the Workflow Structure"
sectionSlug: anatomy-of-a-workflow
order: 1
---

A junior developer submitted their first GitHub Actions workflow for code review. The CI runner immediately rejects it with a YAML parsing error because the hierarchy is wrong.

Your task:

1. **Fix the nesting** so that the steps belong to a named job, not as siblings of the `jobs` key.
2. **Specify the runner environment** so the job knows which operating system to use.

The grader checks that the workflow parses correctly with a named job containing both a runner declaration and a steps array.
