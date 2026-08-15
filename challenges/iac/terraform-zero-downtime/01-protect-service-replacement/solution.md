### service.tf

```hcl
resource "aws_lb_target_group" "orders" {
  name     = "orders-prod"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    path              = "/ready"
    matcher           = "200-299"
    interval          = 30
    healthy_threshold = 3
  }
}

resource "aws_launch_template" "orders" {
  name_prefix = "orders-"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_group" "orders" {
  min_size = 3
  max_size = 6

  instance_refresh {
    strategy = "Rolling"

    preferences {
      min_healthy_percentage = 90
      instance_warmup        = 120
    }
  }
}
```

Terraform can now preserve old capacity until new instances satisfy the same health contract used for traffic.
