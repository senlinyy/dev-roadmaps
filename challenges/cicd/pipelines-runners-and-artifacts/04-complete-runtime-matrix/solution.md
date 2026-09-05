### pipeline.yaml

```yaml
version: 2
jobs:
  tests:
    needs: []
    steps:
      -
        checkout:
          ref: "candidate"
      -
        setup:
          runtime: "matrix"
      -
        install:
          mode: "locked"
      -
        check:
          name: "unit"
    pool: "public"
    matrix:
      os:
        - "linux"
        - "windows"
      runtime:
        - "22"
        - "24"
  package:
    needs:
      - "tests"
    steps:
      -
        checkout:
          ref: "candidate"
      -
        setup:
          runtime: "24"
      -
        install:
          mode: "locked"
      -
        build:
          artifact: "app"
```

Each matrix child has its own checkout and installation. Depending on the logical tests job expands the packaging prerequisites to all four children, so one failed combination prevents build.
