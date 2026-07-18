```yaml
name: Security Scan
on: [push]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Alpine Scanner
        uses: docker://alpine:3.20
        with:
          entrypoint: /bin/sh
          args: -c "echo 'Scanning...'"
```

The `docker://` prefix runs only this step inside the pinned Alpine image while the job remains on its Ubuntu runner. Keeping the entrypoint and arguments on the same step makes the execution boundary explicit in review.
