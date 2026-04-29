```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

Branch filters ensure expensive CI runs only happen for changes headed toward your production branch. For `push`, it matches the branch being pushed to. For `pull_request`, it matches the base branch the PR targets.
