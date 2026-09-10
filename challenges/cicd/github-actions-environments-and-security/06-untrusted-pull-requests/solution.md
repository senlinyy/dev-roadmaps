### .github/workflows/ci.yml

```yaml
"name": "Checkout delivery"
"on":
  "pull_request":
    "branches":
      - "main"
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
    "if": "github.event_name == 'push' && github.ref == 'refs/heads/main'"
  "release":
    "needs": "package"
    "runs-on": "ubuntu-latest"
    "steps":
      -
        "uses": "actions/download-artifact@v4"
        "with":
          "name": "app"
          "path": "package"
      -
        "uses": "aws-actions/configure-aws-credentials@v5"
        "with":
          "role-to-assume": "arn:aws:iam::123456789012:role/checkout-production"
          "aws-region": "us-east-1"
      -
        "run": "bash package/deploy.sh"
    "environment": "production"
    "permissions":
      "contents": "read"
      "id-token": "write"
    "if": "github.event_name == 'push' && github.ref == 'refs/heads/main'"
```

Contributor code receives validation without release authority. A trusted main push crosses the separate environment and cloud gates before deployment.
