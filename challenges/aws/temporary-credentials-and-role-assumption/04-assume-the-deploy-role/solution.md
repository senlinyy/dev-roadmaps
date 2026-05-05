```bash
aws sts get-caller-identity
aws sts assume-role --role-arn arn:aws:iam::123456789012:role/devpolaris-github-deploy-role --role-session-name github-actions-deploy
```

The important part is the handoff. The starting caller is allowed to request a temporary session for a role with a specific job.
