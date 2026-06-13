---
title: "Credentials and Security"
description: "Protect sensitive API keys inside the encrypted credentials vault, mask secrets dynamically in logs, and isolate controllers from compromised agents."
overview: "Jenkins often holds deploy power for registries, clouds, clusters, and source-control systems. Learn how credentials binding works, where log masking helps, why trusted pipeline authors matter, and how teams replace long-lived static cloud keys with federated credentials."
tags: ["jenkins", "security", "credentials", "secrets"]
order: 5
id: article-cicd-jenkins-credentials-and-security
aliases:
  - /cicd/jenkins/credentials-and-security
---

## Table of Contents

1. [Why Jenkins Secrets Need Boundaries](#why-jenkins-secrets-need-boundaries)
2. [Binding Credentials Into Builds](#binding-credentials-into-builds)
3. [How Masking Actually Works and Where It Fails](#how-masking-actually-works-and-where-it-fails)
4. [The Groovy Sandbox and Script Approval](#the-groovy-sandbox-and-script-approval)
5. [Untrusted Pull Requests in Multibranch Pipelines](#untrusted-pull-requests-in-multibranch-pipelines)
6. [From Static Keys to OIDC Federated Credentials](#from-static-keys-to-oidc-federated-credentials)
7. [Putting It All Together](#putting-it-all-together)

## Why Jenkins Secrets Need Boundaries
<!-- section-summary: Jenkins credentials need storage boundaries, runtime boundaries, author trust boundaries, and branch boundaries. -->

Jenkins sits in a powerful position. It checks out source code, builds artifacts, pushes images, deploys to clusters, publishes release notes, and sometimes talks to cloud accounts. To do that work, it often needs secrets: registry passwords, SSH keys, API tokens, cloud credentials, kubeconfig files, signing keys, and webhook tokens.

Summit Retail learns this through a simple mistake. A developer adds `docker login -u summit -p super-secret` to a shell step during a late release. Jenkins prints commands and logs to the build console, so the password lands in a place many engineers can read. The security team rotates the registry credential, but the bigger lesson is about boundaries.

A **credential** in Jenkins is a stored secret or identity material that jobs can use without hardcoding the value in a Jenkinsfile. Jenkins stores credentials through its credentials system, and jobs refer to them by a `credentialsId`. The Jenkinsfile should know the ID and the scope of use, while the raw secret value stays in the credentials store or an external secret provider.

There are four boundaries to think about:

| Boundary | Question it answers | Jenkins mechanism |
|---|---|---|
| Storage boundary | Where does the secret value live? | Jenkins credentials store, external secret manager, JCasC references |
| Runtime boundary | Which step receives the secret? | `withCredentials`, scoped environment variables, isolated agents |
| Author boundary | Who can write code that uses the secret? | Job permissions, repository permissions, script sandbox, trusted libraries |
| Branch boundary | Which branch or PR can reach the secret? | Multibranch trust settings, `when` gates, credential scope |

The rest of the article follows those boundaries. First the team binds credentials into a build safely. Then they look at masking, because masking is useful but limited. After that they cover Groovy sandboxing, untrusted pull requests, and the move from static cloud keys to OIDC federation.

## Binding Credentials Into Builds
<!-- section-summary: Credentials binding gives one pipeline block temporary environment variables or files that reference stored Jenkins credentials. -->

The **Credentials Binding plugin** gives pipelines a step called `withCredentials`. This step takes a stored Jenkins credential, exposes it to a small block as an environment variable or temporary file, and removes that binding after the block finishes. The Jenkinsfile uses the credential ID, while Jenkins handles the secret value at runtime.

Summit Retail stores a Docker registry username and password as a Jenkins credential with ID `registry-prod-push`. The publish stage can bind that credential only around the `docker login` and `docker push` commands:

```groovy
stage('Publish Image') {
    when {
        branch 'main'
    }
    agent { label 'linux && docker' }
    steps {
        withCredentials([usernamePassword(
            credentialsId: 'registry-prod-push',
            usernameVariable: 'REGISTRY_USER',
            passwordVariable: 'REGISTRY_PASSWORD'
        )]) {
            sh '''
                set +x
                printf '%s' "$REGISTRY_PASSWORD" | docker login registry.summit.example -u "$REGISTRY_USER" --password-stdin
                docker push "$IMAGE"
            '''
        }
    }
}
```

The stage has three useful controls. The `when` block keeps publishing on `main`. The `withCredentials` block keeps the registry secret inside one narrow scope. The shell uses `--password-stdin`, so the password travels through standard input instead of appearing as a command-line argument.

Jenkins supports several credential shapes. **Secret text** works for API tokens. **Username and password** works for registries and basic-auth services. **SSH private key** works for Git or remote deployment targets. **Secret file** works for kubeconfig files, certificates, signing keys, or OIDC token files. The pipeline should choose the narrowest type that matches the tool.

Here is an SSH key binding for a private Git fetch:

```groovy
withCredentials([sshUserPrivateKey(
    credentialsId: 'release-bot-ssh',
    keyFileVariable: 'SSH_KEY',
    usernameVariable: 'SSH_USER'
)]) {
    sh '''
        set +x
        GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes" git fetch git@github.com:summit/private-release-data.git
    '''
}
```

The binding gives the shell a temporary key file path. Jenkins deletes the temporary file after the block completes. The agent still matters, because any process running as the same operating-system user during that window may have opportunities to inspect environment or process data. Sensitive jobs deserve isolated agents or single-executor agents, especially when teams run code from many repositories.

## How Masking Actually Works and Where It Fails
<!-- section-summary: Masking reduces accidental console leaks, while credential scope and trusted authors provide the real security boundary. -->

When Jenkins binds a secret, it tries to mask matching secret values in the build log. If a tool prints the registry password, Jenkins may replace it with `****`. This protects against common accidents, such as a shell command echoing an environment variable or a CLI showing a token in normal output.

Masking has limits because a pipeline author who can use a credential can usually send it somewhere on purpose. The author can base64-encode it, split it into pieces, write it to a file artifact, send it to a network endpoint, or run a tool that hides the value from the log but still exfiltrates it. Jenkins log masking helps with accidental exposure; the stronger control is deciding which jobs, branches, authors, and agents can access the credential at all.

There is also a shell detail that matters. In Groovy, double-quoted strings can interpolate variables before the shell receives the script. In many cases, single-quoted Groovy strings or triple single-quoted shell blocks keep expansion inside the shell, which reduces the chance that Jenkins stores the secret in step metadata or process arguments.

This pattern keeps the shell responsible for expansion:

```groovy
withCredentials([string(credentialsId: 'payments-api-token', variable: 'API_TOKEN')]) {
    sh '''
        set +x
        curl -H "Authorization: Bearer $API_TOKEN" https://api.summit.example/release
    '''
}
```

This pattern expands in Groovy before the shell runs, which creates extra exposure in process listings and Jenkins step metadata:

```groovy
withCredentials([string(credentialsId: 'payments-api-token', variable: 'API_TOKEN')]) {
    sh """
        curl -H "Authorization: Bearer ${API_TOKEN}" https://api.summit.example/release
    """
}
```

Masking also struggles with tools that transform output. A command can print a URL-encoded token, a JSON-escaped token, a wrapped line, or a debug dump with partial values. The team should still set `set +x`, avoid debug logs around secrets, keep credentials out of command-line arguments where possible, and run secret-using steps on agents that untrusted jobs cannot share.

The simple review question is this: who can change the code inside the `withCredentials` block? If that answer includes fork contributors, broad repository write access, or any pipeline author outside the trusted deployment group, the credential scope is too wide for production deploy power.

## The Groovy Sandbox and Script Approval
<!-- section-summary: The Groovy sandbox limits which Jenkins and Java APIs untrusted pipeline code can call. -->

Jenkins Pipeline executes Groovy, and Groovy can be very powerful. A script with wide access could try to read files, call Java APIs, inspect Jenkins internals, or change controller behavior. Jenkins uses the **Script Security plugin** to reduce that risk through the **Groovy sandbox** and **script approval**.

The **Groovy sandbox** allows common pipeline operations while blocking method calls that Jenkins has not approved for sandboxed scripts. When a pipeline tries to call a restricted method, Jenkins stops the script and records a pending approval item. An administrator can review the requested signature in Manage Jenkins, In-process Script Approval.

This matters for shared libraries and Jenkinsfiles. A normal application Jenkinsfile usually runs in the sandbox. A folder-level shared library also runs in the sandbox. A trusted global library can run outside those restrictions, so that library repository needs stricter review and branch protection than a normal application repository.

Here is the practical review path. If a sandbox rejection appears, the team should ask why the pipeline needs that API. A normal application build rarely needs direct access to Jenkins controller internals. The safer fix often moves the operation into a supported pipeline step, a CLI on an agent, or a narrow trusted shared-library function owned by the platform team.

Approving signatures by habit weakens the boundary. Each approval lets sandboxed pipeline code call more powerful APIs in the future. A useful approval record should mention which job needed it, why a normal step could not do the work, which data the method can reach, and whether a trusted shared-library wrapper would be safer.

The sandbox connects back to credentials. If a Jenkinsfile can call unusual APIs and also bind production credentials, a small review miss can grow into a serious incident. Strong Jenkins security combines sandbox defaults, careful approvals, restricted credential scopes, and isolated agents.

## Untrusted Pull Requests in Multibranch Pipelines
<!-- section-summary: A pull request can change pipeline code, so fork trust settings and credential gates decide whether secrets stay protected. -->

Multibranch Pipeline makes Jenkins convenient because every branch or pull request can bring its own Jenkinsfile. That same feature creates a security question. If a fork contributor can edit a Jenkinsfile, and Jenkins runs that file with production credentials, the pull request can try to steal the credential.

Summit Retail has a public repository for a small SDK. A contributor opens a pull request that changes a test script. If the PR job receives the Docker registry credential, the contributor can modify the test to print or send the secret. Log masking might hide a direct print, but it cannot turn an untrusted pipeline author into a trusted one.

Branch source plugins provide trust settings for pull requests from forks. The exact labels depend on the SCM plugin, but the security idea stays the same:

| Trust choice | What usually happens | Good fit |
|---|---|---|
| Trust nobody from forks | Jenkins uses maintainer-controlled pipeline logic for fork PRs | Public repositories and broad contributor bases |
| Trust known contributors | Jenkins trusts PR pipeline code from recognized contributors | Private or semi-open projects with clear membership |
| Trust everyone | Jenkins runs fork-provided pipeline code as trusted | Rare internal setups with tightly controlled forks |

For public repositories, Summit Retail keeps fork PR builds on a safe path. PRs compile, lint, and test without production credentials. Deployment stages run only after reviewed code reaches `main`. Registry push credentials live in a folder or credential domain that only trusted jobs can access, and the Jenkinsfile still uses branch gates as a second control.

```groovy
stage('Deploy Production') {
    when {
        allOf {
            branch 'main'
            expression { return params.DEPLOY_PRODUCTION }
        }
    }
    steps {
        withCredentials([string(credentialsId: 'prod-deploy-token', variable: 'DEPLOY_TOKEN')]) {
            sh '''
                set +x
                ./scripts/deploy-prod.sh
            '''
        }
    }
}
```

This stage gives production deploy power only to a merged branch and an explicit deployment request. The repository permissions and Jenkins job permissions still matter, because anyone who can merge to `main` can affect the deployment path. CI/CD security always follows the chain of trust from source control to Jenkins to the target environment.

Scan credentials also need attention. Organization folders and multibranch projects often use SCM credentials to discover repositories, index branches, update commit statuses, and check out code. Jenkins documentation warns that credentials available to multibranch jobs can become available to child jobs, so teams should scope scan credentials and checkout credentials with the same care as deploy credentials.

## From Static Keys to OIDC Federated Credentials
<!-- section-summary: OIDC federation lets Jenkins exchange short-lived build identity tokens for cloud credentials instead of storing long-lived access keys. -->

Many Jenkins installations start with static cloud keys. An administrator creates an AWS IAM user named `jenkins-deploy`, stores the access key and secret access key in Jenkins, and uses them to deploy. That works, but the key can live for months, and every rotation requires coordination across Jenkins, cloud IAM, and every pipeline that expects the credential.

**OIDC federation** gives CI jobs a different path. OIDC stands for OpenID Connect. A Jenkins build receives a short-lived identity token from a trusted issuer, and the cloud provider exchanges that token for temporary credentials tied to a role. AWS uses `sts:AssumeRoleWithWebIdentity` for this style of flow.

The Jenkins OpenID Connect Provider plugin can issue build-specific ID tokens. The external service, such as AWS or GCP, trusts the issuer URL and verifies the signed token. The trust policy can check claims such as audience, subject, job name, or branch name, so only the intended Jenkins job can assume the role.

For AWS, the role trust policy shape looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/jenkins.summit.example/oidc"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "jenkins.summit.example/oidc:aud": "sts.amazonaws.com",
          "jenkins.summit.example/oidc:sub": "https://jenkins.summit.example/job/checkout-api/job/main/"
        }
      }
    }
  ]
}
```

The `Principal` names the IAM OIDC provider that represents Jenkins. The `Action` allows web identity federation. The `aud` condition checks that the token was meant for AWS STS, so the Jenkins OIDC credential audience or client ID must match `sts.amazonaws.com`. The `sub` condition narrows which Jenkins job identity can assume the role, and this example uses the plugin's default subject style: the Jenkins job URL.

A pipeline can then use an OIDC token file credential and the AWS CLI's web identity environment variables:

```groovy
withCredentials([file(credentialsId: 'aws-prod-oidc-token', variable: 'AWS_WEB_IDENTITY_TOKEN_FILE')]) {
    withEnv([
        'AWS_ROLE_ARN=arn:aws:iam::123456789012:role/checkout-api-prod-deploy',
        "AWS_ROLE_SESSION_NAME=jenkins-${env.BUILD_NUMBER}",
        'AWS_DEFAULT_REGION=us-east-1'
    ]) {
        sh '''
            set +x
            aws sts get-caller-identity
            ./scripts/deploy-aws.sh
        '''
    }
}
```

This design removes the long-lived AWS access key from Jenkins. The build receives a short-lived token, AWS verifies the token, and STS returns temporary credentials for a role with narrow permissions. If a token leaks, its lifetime and claim restrictions limit the incident compared with a static access key that remains valid until rotation.

OIDC still needs operational care. Jenkins must serve a stable HTTPS issuer or a configured alternate issuer. The IAM provider must trust the right issuer and audience. The role policy must grant only the needed actions. The trust policy must narrow subjects enough that one pipeline cannot borrow another pipeline's deploy role. The pipeline should still keep the token binding in the smallest possible block.

## Putting It All Together
<!-- section-summary: Jenkins security works when storage, runtime scope, author trust, branch trust, and cloud identity all line up. -->

Summit Retail's final Jenkins setup has layered boundaries. Secrets live in Jenkins credentials or an external secret provider. Jenkinsfiles bind those credentials only inside narrow `withCredentials` blocks. Shell steps use `set +x`, stdin, and environment expansion patterns that reduce accidental leaks. Sensitive jobs run on isolated agents.

The team also controls who can write secret-using code. Application Jenkinsfiles stay sandboxed. Trusted shared libraries live in protected repositories. Script approvals receive real review. Public pull requests run tests without production credentials. Deploy stages wait for trusted branches and explicit release intent.

For cloud deployments, the team starts moving from static keys to OIDC federation. Jenkins issues a build identity token, AWS exchanges it for temporary role credentials, and role trust conditions tie that access to a specific job path and audience. The pipeline still uses Jenkins credentials binding, but the credential now represents a short-lived identity flow instead of a long-lived secret.

That completes the Jenkins module. The architecture gives the controller and agents a clean boundary. Jenkinsfiles make delivery reviewable. Shared libraries reduce repeated pipeline code. Plugins and Configuration as Code make the controller rebuildable. Credentials and security keep the deploy power inside Jenkins scoped to the people, branches, jobs, and runtimes that should have it.

---

**References**

- [Jenkins: Credentials](https://www.jenkins.io/doc/book/security/credentials/) - Explains Jenkins credentials, credential scope, and secret protection guidance.
- [Jenkins Credentials Binding plugin](https://plugins.jenkins.io/credentials-binding/) - Documents credentials binding, environment variable use, and automatic masking behavior.
- [Jenkins Pipeline Steps: Credentials Binding](https://www.jenkins.io/doc/pipeline/steps/credentials-binding/) - Provides `withCredentials` syntax, binding types, masking caveats, and environment-variable warnings.
- [Jenkins: In-process Script Approval](https://www.jenkins.io/doc/book/managing/script-approval/) - Explains the Groovy sandbox and administrator script approval flow.
- [Jenkins: Securing SCM credentials for Organization Folders and Multibranch Pipelines](https://www.jenkins.io/doc/book/security/securing-org-folders-and-multibranch-pipelines/) - Documents trust risks when Jenkinsfiles can use credentials in multibranch jobs.
- [Jenkins: Controller Isolation](https://www.jenkins.io/doc/book/security/controller-isolation/) - Explains agent-to-controller access control and controller isolation from build execution.
- [Jenkins OpenID Connect Provider plugin](https://plugins.jenkins.io/oidc-provider/) - Documents Jenkins-issued OIDC ID tokens for keyless authentication to external systems.
- [AWS IAM: OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html) - Explains OIDC federation and temporary AWS credentials for CI/CD workloads.
- [AWS IAM: Create a role for OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html) - Documents OIDC provider trust policies and `sts:AssumeRoleWithWebIdentity`.
