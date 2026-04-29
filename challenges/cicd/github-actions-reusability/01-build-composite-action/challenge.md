---
title: "Build a Composite Action"
sectionSlug: creating-a-composite-action
order: 1
---

You are extracting a common setup sequence (Node.js installation and dependency installation) into a reusable composite action so that multiple repositories can reference it instead of duplicating the same YAML.

Your task:

1. **Set the correct `using` value** in the `runs` block to declare this as a composite action (not a Docker or JavaScript action).
2. **Add the required shell declaration** to every `run` step. Composite actions require this because they can be called from runners with different default shells.

The grader validates that the action uses the correct composite syntax and that all run steps declare their shell.
