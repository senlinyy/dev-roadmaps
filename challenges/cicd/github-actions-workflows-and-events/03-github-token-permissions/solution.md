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
        "uses": "actions/setup-node@v7"
        "with":
          "node-version": 24
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
  "report":
    "needs": "validate"
    "runs-on": "ubuntu-latest"
    "steps":
      -
        "uses": "actions/checkout@v6"
        "with":
          "persist-credentials": false
      -
        "run": "./scripts/publish-status.sh"
      -
        "run": "echo \"reported=${{ needs.validate.outputs.revision }}\" >> \"$GITHUB_OUTPUT\""
    "permissions":
      "contents": "read"
      "checks": "write"
```

The status identifies the exact checked commit. Validation remains read-only while its downstream reporting job has only the authority needed to publish the result.
