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
    "runs-on":
      "group": "legacy"
      "labels":
        - "self-hosted"
        - "linux"
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
        "run": "npm test"
      -
        "run": "npm run build"
      -
        "run": "./scripts/cleanup.sh"
        "if": "always()"
```

Both ends of the persistent-worker lifecycle are repaired. A failed test cannot leave the authored credential references or generated outputs for the next workload.
