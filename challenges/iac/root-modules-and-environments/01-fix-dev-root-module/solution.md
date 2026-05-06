### envs/dev/main.tf

```hcl
module "orders_service" {
  source = "../../modules/orders-service"

  service_name        = "orders-api"
  environment         = "dev"
  invoice_bucket_name = "dp-orders-invoices-dev"
  export_bucket_name  = "dp-orders-exports-dev"
  deletion_protection = false
  replica_count       = 1
}
```

### modules/orders-service/variables.tf

```hcl
variable "service_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "invoice_bucket_name" {
  type = string
}

variable "export_bucket_name" {
  type = string
}

variable "deletion_protection" {
  type = bool
}

variable "replica_count" {
  type = number
}
```

The root module points at the shared child module and supplies values that clearly belong to development.
