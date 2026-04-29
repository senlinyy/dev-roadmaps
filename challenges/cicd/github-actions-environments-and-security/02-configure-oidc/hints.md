OIDC requires two things on the GitHub side: a `permissions` block with `id-token: write` (so GitHub generates the JWT), and the `aws-actions/configure-aws-credentials` action with a `role-to-assume` parameter (so the action exchanges the JWT for temporary AWS credentials via STS).

---

The `id-token` permission is not granted by default. Without it, the `configure-aws-credentials` action will fail with an error about not being able to get an ID token.
