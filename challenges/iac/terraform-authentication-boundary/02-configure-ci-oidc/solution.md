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
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: arn:aws:iam::123456789012:role/devpolaris-terraform-plan
          aws-region: eu-west-2
      - name: Terraform init
        run: terraform init
      - name: Terraform plan
        run: terraform plan -input=false
```

The workflow receives short-lived AWS credentials scoped by the cloud trust policy rather than storing reusable keys.
