### variables.tf

```hcl
variable "db_password" {
  type      = string
  sensitive = true
  ephemeral = true
}

variable "db_password_version" {
  type = number
}
```

### database.tf

```hcl
resource "aws_db_instance" "orders" {
  identifier          = "orders-prod"
  engine              = "postgres"
  instance_class      = "db.t4g.micro"
  allocated_storage   = 20
  username            = "orders_admin"
  password_wo         = var.db_password
  password_wo_version = var.db_password_version
}
```

The password enters only the provider write boundary, while an explicit version value gives Terraform a safe rotation signal.
