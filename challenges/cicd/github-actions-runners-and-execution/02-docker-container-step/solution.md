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
  "integration":
    "runs-on": "ubuntu-latest"
    "steps":
      -
        "uses": "actions/checkout@v6"
        "with":
          "persist-credentials": false
      -
        "run": "npm ci"
      -
        "run": "npm run integration"
      -
        "run": "npm run build"
    "container": "node:24"
    "services":
      "postgres":
        "image": "postgres:17"
        "env":
          "POSTGRES_PASSWORD": "training-only"
        "options": "--health-cmd pg_isready --health-interval 5s --health-timeout 3s --health-retries 4"
```

The job image supplies Node while the service health contract controls when integration may begin. An unhealthy database blocks execution before a build.
