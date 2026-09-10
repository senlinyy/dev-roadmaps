## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### .github/workflows/identity.yml

```yaml
name: Identity
on: [workflow_dispatch]
permissions:
  contents: read
jobs:
  identify:
    runs-on: ubuntu-24.04
    environment: production
    permissions:
      id-token: write
    steps:
      - uses: aws-actions/configure-aws-credentials@cabfdba3510de1431bac9dba27511d97497fc100
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: eu-west-1
      - run: aws sts get-caller-identity
```

### iam/trust.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::222222222222:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:acme/orders:environment:production"
        }
      }
    }
  ]
}
```

## Why this works

OIDC exchanges a short-lived GitHub identity assertion for an AWS session. Token request permission, role trust and role permissions are separate. Match the actual sub claim: this fixture deliberately uses an existing repository's legacy subject; newly created or opted-in repositories can include immutable owner/repository IDs. Environment trust also requires branch restrictions in GitHub because the environment-form subject does not itself constrain a branch.

## Verification and expected evidence

Administrator: register the GitHub OIDC provider with sts.amazonaws.com audience and apply the role trust policy. Configure production AWS_ROLE_ARN, reviewers and main-only branch policy. Confirm assumed-role identity, then test a rejected environment/repository. Deactivate the legacy key, rerun without key secrets, inspect remaining consumers, then delete the key and secrets after the agreed observation period.

## Self-review

- [ ] The production environment requests a token and assumes only the named role.
- [ ] Trust matches the supplied audience and exact environment subject.
- [ ] An unauthorized environment or repository is denied; old keys are retired only after validation.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
