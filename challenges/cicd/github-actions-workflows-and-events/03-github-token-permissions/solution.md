```yaml
jobs:
  comment:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
```

When you declare an explicit `permissions` block, it overrides all defaults. The job only gets the scopes you list. `pull-requests: write` allows the token to create comments on PRs. `contents: read` allows `actions/checkout` to clone the repository.
