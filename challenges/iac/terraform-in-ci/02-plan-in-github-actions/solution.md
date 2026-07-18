```yaml
name: terraform-prod-checks

on:
  pull_request:
    paths:
      - "infra/orders/prod/**"

permissions:
  contents: read

jobs:
  terraform:
    runs-on: ubuntu-latest
    defaults:
      run:
        shell: bash
    steps:
      - name: Checkout
        uses: actions/checkout@v6
      - name: Set up Terraform
        uses: hashicorp/setup-terraform@v4
      - name: Init
        run: terraform -chdir=infra/orders/prod init -input=false
      - name: Format check
        run: terraform -chdir=infra/orders/prod fmt -check
      - name: Validate
        run: terraform -chdir=infra/orders/prod validate
      - name: Plan
        run: terraform -chdir=infra/orders/prod plan -input=false
```

The job stops at a speculative plan, so a pull request produces review evidence without gaining an apply path. Keeping every command on the same root module also prevents CI from validating a different directory than the one it plans.
