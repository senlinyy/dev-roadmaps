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
    "runs-on": "ubuntu-latest"
    "steps":
      -
        "uses": "actions/download-artifact@v4"
        "with":
          "name": "app"
          "path": "package"
      -
        "run": "bash package/deploy.sh"
    "environment": "production"
```

### environment-settings.json

```json
{
  "environments": {
    "production": {
      "branches": [
        "main"
      ],
      "reviewers": [
        "release-manager"
      ],
      "preventSelfReview": true,
      "secrets": [
        "PRODUCTION_TOKEN"
      ]
    }
  }
}
```

The environment gates the job before production authority appears. Validation and packaging remain outside that boundary, while missing or self-approval stops release.
