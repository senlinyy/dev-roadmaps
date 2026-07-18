### variables.tf

```hcl
variable "enable_waf" {
  type    = bool
  default = false
}

variable "waf_acl_arn" {
  type    = string
  default = null
}
```

### main.tf

```hcl
resource "aws_lb" "app" {
  name = "orders-app"
}

resource "aws_wafv2_web_acl_association" "app" {
  count = var.enable_waf ? 1 : 0

  resource_arn = aws_lb.app.arn
  web_acl_arn  = var.waf_acl_arn
}
```

The boolean expresses deployment intent, while the conditional count creates no association in environments where WAF is disabled.
