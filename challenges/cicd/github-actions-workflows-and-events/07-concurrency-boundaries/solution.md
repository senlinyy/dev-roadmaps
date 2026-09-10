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
    "if": "github.event_name == 'pull_request'"
    "concurrency":
      "group": "pr-${{ github.event.pull_request.number }}"
      "cancel-in-progress": true
  "release":
    "if": "github.event_name == 'push'"
    "runs-on": "ubuntu-latest"
    "environment": "production"
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
      -
        "uses": "actions/download-artifact@v4"
        "with":
          "name": "app"
          "path": "package"
      -
        "run": "bash package/deploy.sh"
    "concurrency":
      "group": "deploy-production"
      "cancel-in-progress": false
```

PR-specific groups avoid cancelling unrelated reviews. The production group serializes the two authored releases without aborting an in-progress deployment.
