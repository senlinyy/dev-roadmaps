### network.tf

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = "orders-prod"
  cidr = "10.42.0.0/16"
}
```

The compatible range permits reviewed patch and minor upgrades while blocking an accidental major-version jump.
