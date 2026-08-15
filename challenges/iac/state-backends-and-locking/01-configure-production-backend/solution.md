### backend.tf

```hcl
terraform {
  backend "s3" {
    bucket       = "dp-terraform-state-prod"
    key          = "orders/prod/terraform.tfstate"
    region       = "eu-west-2"
    use_lockfile = true
  }
}
```

The state path isolates one stack, while lockfile support coordinates writers without persisting credentials.
