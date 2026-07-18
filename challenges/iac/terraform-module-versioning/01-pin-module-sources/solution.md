```hcl
module "network" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"
}

module "observability" {
  source = "git::https://github.com/devpolaris/terraform-observability.git?ref=v2.4.1"
}
```

Both dependencies now change only through an explicit reviewed edit. Registry and Git sources use different versioning mechanisms.
