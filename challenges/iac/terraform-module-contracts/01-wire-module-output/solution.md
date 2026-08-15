### modules/app/outputs.tf

```hcl
output "endpoint" {
  description = "Application load balancer hostname"
  value       = aws_lb.app.dns_name
}
```

### modules/monitoring/variables.tf

```hcl
variable "endpoint" {
  type        = string
  description = "Hostname checked by the availability monitor"
}
```

### modules/monitoring/main.tf

```hcl
resource "aws_synthetics_canary" "availability" {
  name                 = "orders-availability"
  artifact_s3_location = "s3://dp-monitoring-artifacts"
  handler              = "index.handler"
  runtime_version      = "syn-nodejs-puppeteer-10.0"
  start_canary         = true

  environment_variables = {
    TARGET_ENDPOINT = var.endpoint
  }
}
```

### live/prod/main.tf

```hcl
module "app" {
  source = "../../modules/app"
}

module "monitoring" {
  source   = "../../modules/monitoring"
  endpoint = module.app.endpoint
}
```

The root module owns composition while each child exposes only its supported public contract.
