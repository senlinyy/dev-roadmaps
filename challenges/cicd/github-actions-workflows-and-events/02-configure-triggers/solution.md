### .github/workflows/ci.yml

```yaml
"name": "Checkout delivery"
"on":
  "pull_request":
    "branches":
      - "main"
    "paths":
      - "backend/**"
      - ".github/workflows/**"
  "push":
    "branches":
      - "main"
    "paths":
      - "backend/**"
      - ".github/workflows/**"
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
```

PR targeting and push identity are evaluated separately. Path filtering removes irrelevant work without allowing PR validation to become release authority.
