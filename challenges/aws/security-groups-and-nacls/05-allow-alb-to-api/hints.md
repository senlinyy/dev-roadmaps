Target `sg-orders-api`, safe source `sg-orders-alb`, and port `3000`. Avoid `0.0.0.0/0`.

---

Use EC2 security group ingress authorization to allow TCP port `3000` from `sg-orders-alb` into `sg-orders-api`.

---

After the change, inspect security group `sg-orders-api` again.
