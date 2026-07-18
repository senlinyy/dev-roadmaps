`.github/workflows/service-security.yml`:

```yaml
name: Service Security
on:
  workflow_call:
    inputs:
      service-name:
        required: true
        type: string

jobs:
  security:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/security-scan.sh "${{ inputs.service-name }}"
```

`.github/workflows/ci.yml`:

```yaml
name: Service CI
on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test

  security:
    uses: acme/platform-workflows/.github/workflows/service-security.yml@v1
    with:
      service-name: checkout-api
```

The `workflow_call` declaration creates an explicit typed interface, and the caller consumes it at job level. Keeping the runner and permissions inside the reusable workflow lets the platform team enforce the complete security-job boundary.
