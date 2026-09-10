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
        "uses": "actions/checkout@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
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
        "uses": "actions/checkout@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
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
```

The immutable reference avoids the authored tag change. Independent privilege separation prevents source validation from inheriting production secrets or write authority.
