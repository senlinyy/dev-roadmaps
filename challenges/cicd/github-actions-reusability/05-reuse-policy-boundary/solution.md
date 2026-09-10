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
  "package":
    "needs": "validate"
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
        "run": "npm run build"
      -
        "uses": "actions/upload-artifact@v4"
        "with":
          "name": "app"
          "path": "dist"
          "if-no-files-found": "error"
  "release":
    "needs": "package"
    "uses": "./.github/workflows/release.yml"
    "with":
      "environment": "staging"
    "secrets":
      "deploy-token": "${{ secrets.STAGING_TOKEN }}"
```

### .github/workflows/release.yml

```yaml
"name": "Checkout delivery"
"on":
  "workflow_call":
    "inputs":
      "environment":
        "type": "string"
        "required": true
    "secrets":
      "deploy-token":
        "required": true
"permissions":
  "contents": "read"
"jobs":
  "release":
    "runs-on": "ubuntu-latest"
    "steps":
      -
        "uses": "actions/download-artifact@v4"
        "with":
          "name": "app"
          "path": "package"
      -
        "run": "bash package/deploy.sh"
        "env":
          "DEPLOY_TOKEN": "${{ secrets.deploy-token }}"
    "environment": "${{ inputs.environment }}"
```

The caller owns the target and secret decision. The reusable workflow consumes the selected artifact and cannot deploy with a missing token or after failed validation.
