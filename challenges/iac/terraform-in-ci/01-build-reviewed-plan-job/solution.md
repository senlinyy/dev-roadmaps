### .github/workflows/terraform-plan.yml

```yaml
name: Terraform plan
on:
  pull_request:
permissions:
  contents: read
  id-token: write
jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check formatting
        run: terraform fmt -check -recursive
      - name: Initialize
        run: terraform init -input=false
      - name: Validate
        run: terraform validate
      - name: Plan
        run: terraform plan -input=false -out=release.tfplan
      - name: Upload reviewed plan
        uses: actions/upload-artifact@v4
        with:
          name: terraform-plan
          path: release.tfplan
          retention-days: 2
```

The workflow layers cheap checks before planning and preserves a short-lived review artifact without granting pull requests an apply boundary.
