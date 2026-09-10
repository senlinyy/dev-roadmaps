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
        "id": "cache"
        "uses": "actions/cache@v4"
        "with":
          "path": "~/.npm"
          "key": "${{ runner.os }}-24-${{ hashFiles('package-lock.json') }}"
      -
        "run": "npm ci"
      -
        "run": "npm test"
      -
        "run": "npm run build"
```

Cache identity controls reuse, while locked installation remains mandatory. No cached node_modules or stale build output can substitute for current preparation.
