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
    "runs-on": "ubuntu-latest"
    "steps":
      -
        "uses": "actions/checkout@v6"
        "with":
          "persist-credentials": false
      -
        "id": "validation"
        "uses": "./.github/actions/validate"
        "with":
          "node": "24"
      -
        "run": "echo \"validated=${{ steps.validation.outputs.revision }}\" >> \"$GITHUB_OUTPUT\""
```

### .github/actions/validate/action.yml

```yaml
"name": "Checkout validation"
"description": "Validate checkout on the caller worker"
"inputs":
  "node":
    "description": "Node version"
    "required": true
"outputs":
  "revision":
    "description": "Validated source"
    "value": "${{ steps.identity.outputs.revision }}"
"runs":
  "using": "composite"
  "steps":
    -
      "uses": "actions/setup-node@v7"
      "with":
        "node-version": "${{ inputs.node }}"
    -
      "run": "npm ci"
      "shell": "bash"
    -
      "run": "npm run lint"
      "shell": "bash"
    -
      "run": "npm test"
      "shell": "bash"
    -
      "id": "identity"
      "shell": "bash"
      "run": "echo \"revision=${{ github.sha }}\" >> \"$GITHUB_OUTPUT\""
```

The action owns reusable validation while the caller owns checkout and consumes a stable result interface. The output reflects the source actually checked.
