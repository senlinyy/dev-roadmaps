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

### cloud-trust.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:acme/checkout:environment:production"
        }
      }
    }
  ]
}
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

The workflow preserves source-to-artifact lineage and causal validation gates. Environment approval and narrowly scoped cloud trust independently prevent unauthorized production access.
