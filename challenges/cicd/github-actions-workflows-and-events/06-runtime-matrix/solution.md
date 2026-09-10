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
  "test":
    "runs-on": "${{ matrix.os }}"
    "steps":
      -
        "uses": "actions/checkout@v6"
        "with":
          "persist-credentials": false
      -
        "uses": "actions/setup-node@v7"
        "with":
          "node-version": "${{ matrix.node }}"
      -
        "run": "npm ci"
      -
        "run": "npm test"
    "strategy":
      "fail-fast": false
      "matrix":
        "os":
          - "ubuntu-latest"
          - "windows-latest"
        "node":
          - 22
          - 24
        "exclude":
          -
            "os": "windows-latest"
            "node": 22
  "package":
    "needs": "test"
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
```

Every supported combination produces evidence. A failure still permits remaining compatibility checks to report but prevents packaging.
