### .github/workflows/ci.yml

```yaml
"name": "Checkout delivery"
"on":
  "push":
    "branches":
      - "main"
"permissions":
  "contents": "read"
"jobs":
  "validate":
    "uses": "./.github/workflows/shared.yml"
    "with":
      "node": "24"
  "report":
    "needs": "validate"
    "runs-on": "ubuntu-latest"
    "steps":
      -
        "run": "echo \"validated=${{ needs.validate.outputs.revision }}\" >> \"$GITHUB_OUTPUT\""
```

### .github/workflows/shared.yml

```yaml
"name": "Checkout delivery"
"on":
  "workflow_call":
    "inputs":
      "node":
        "type": "string"
        "required": true
    "outputs":
      "revision":
        "description": "Validated commit"
        "value": "${{ jobs.validate.outputs.revision }}"
"permissions":
  "contents": "read"
"jobs":
  "validate":
    "runs-on": "ubuntu-latest"
    "steps":
      -
        "uses": "actions/checkout@v6"
        "with":
          "persist-credentials": false
      -
        "uses": "actions/setup-node@v7"
        "with":
          "node-version": "${{ inputs.node }}"
      -
        "run": "npm ci"
      -
        "run": "npm run lint"
      -
        "run": "npm test"
      -
        "id": "identity"
        "run": "echo \"revision=${{ github.sha }}\" >> \"$GITHUB_OUTPUT\""
    "outputs":
      "revision": "${{ steps.identity.outputs.revision }}"
```

The shared workflow retains a real job boundary. Its typed input and explicit output let the caller reuse validation without losing source identity or failure propagation.
