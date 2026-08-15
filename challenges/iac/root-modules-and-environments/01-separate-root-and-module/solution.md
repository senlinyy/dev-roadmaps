### live/prod/backend.tf

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

### live/prod/providers.tf

```hcl
provider "aws" {
  region = "eu-west-2"
}
```

### live/prod/main.tf

```hcl
module "service" {
  source        = "../../modules/service"
  environment   = "prod"
  replica_count = 3
}
```

The layout gives production an isolated state record while keeping provider and environment policy out of the reusable child.
