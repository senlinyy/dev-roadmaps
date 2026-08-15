### live/prod/main.tf

```hcl
module "network" {
  source = "../../modules/network"
  cidr   = "10.42.0.0/16"
}

module "service" {
  source             = "../../modules/service"
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
}

module "monitoring" {
  source   = "../../modules/monitoring"
  endpoint = module.service.endpoint
}
```

The flat graph keeps ownership visible and lets each child module be tested and upgraded independently.
