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
    "uses": "acme/platform/.github/workflows/validate.yml@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    "with":
      "node": "24"
  "report":
    "needs": "validate"
    "runs-on": "ubuntu-latest"
    "steps":
      -
        "run": "echo \"validated=${{ needs.validate.outputs.revision }}\" >> \"$GITHUB_OUTPUT\""
```

The caller binds to a reviewed interface rather than tracking main. A breaking branch update therefore cannot silently alter the caller’s validation contract.
