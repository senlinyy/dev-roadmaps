### pipeline.yaml

```yaml
version: 2
jobs:
  ci:
    needs: []
    steps:
      -
        checkout:
          ref: "candidate"
      -
        setup:
          runtime: "24"
      -
        cache:
          key:
            - "os"
            - "runtime"
            - "lock"
      -
        install:
          mode: "locked"
      -
        check:
          name: "lint"
      -
        check:
          name: "unit"
      -
        build:
          artifact: "app"
      -
        upload:
          artifact: "app"
```

Cache selection uses the OS, runtime, and actual lockfile hash. Installation still reconstructs the approved direct dependencies. The artifact is a retained build output; cache state is only an optimization.
