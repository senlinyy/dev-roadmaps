## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### Jenkinsfile

```groovy
pipeline {
  agent { label 'trusted-aws-deploy' }
  options { disableConcurrentBuilds(); timeout(time: 20, unit: 'MINUTES') }
  stages {
    stage('Deploy approved candidate') {
      steps {
        sh '''
          set +x
          set -eu
          credentials=$(aws sts assume-role --role-arn arn:aws:iam::222222222222:role/orders-deploy --role-session-name "jenkins-$BUILD_NUMBER" --query Credentials --output json)
          export AWS_ACCESS_KEY_ID=$(printf '%s' "$credentials" | jq -r .AccessKeyId)
          export AWS_SECRET_ACCESS_KEY=$(printf '%s' "$credentials" | jq -r .SecretAccessKey)
          export AWS_SESSION_TOKEN=$(printf '%s' "$credentials" | jq -r .SessionToken)
          unset credentials
          bash scripts/deploy.sh
        '''
      }
    }
  }
}
```

### iam/trust.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::222222222222:role/orders-jenkins-agent"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### iam/agent-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::222222222222:role/orders-deploy"
    }
  ]
}
```

## Why this works

Jenkins does not inherit GitHub's OIDC identity system. This design uses an explicit EC2 instance role and scoped STS role assumption. IAM trust identifies who may assume; the agent policy authorizes the request; the target role controls ECS operations. Process environment isolation requires a trusted dedicated host/controller boundary, not only log masking.

## Verification and expected evidence

Attach the scoped deployment permission policy from the AWS authorization lesson to orders-deploy. Verify role assumption on the dedicated trusted agent, then denial from a normal build identity. Disable shell tracing around credential handling and inspect archived outputs for accidental exposure. A shared executor host would still expose credentials to other processes.

## Self-review

- [ ] No static AWS key or credential dump remains.
- [ ] Only the named instance role can assume orders-deploy.
- [ ] Temporary credentials exist only around deployment and are never archived.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html)
- [Official reference 2](https://www.jenkins.io/doc/pipeline/steps/credentials-binding/)
