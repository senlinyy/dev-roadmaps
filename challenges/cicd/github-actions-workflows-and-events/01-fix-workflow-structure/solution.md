```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

GitHub Actions requires a strict hierarchy: Workflow > Jobs > Steps. The `steps` array must be a child of the job name, and every job must declare its runner via `runs-on`. Without it, GitHub does not know which VM image to provision.
