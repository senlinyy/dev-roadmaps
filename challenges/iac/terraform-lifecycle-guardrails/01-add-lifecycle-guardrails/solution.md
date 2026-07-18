```hcl
resource "aws_lb" "app" {
  name = "orders-app"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "orders" {
  identifier = "orders-prod"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
}

resource "aws_ecs_service" "orders" {
  name       = "orders"
  depends_on = [aws_lb_listener.https]
}
```

Each guardrail protects the resource with the corresponding operational risk. The explicit dependency documents ordering Terraform cannot otherwise infer.
