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

1. [How Do Jenkins Credentials Store and Transfer Authority?](#how-do-jenkins-credentials-store-and-transfer-authority)
2. [What Do Quoting, Files, Agents, and Masking Protect or Expose?](#what-do-quoting-files-agents-and-masking-protect-or-expose)
3. [How Do the Groovy Sandbox, Script Approval, and Pull Requests Define Trust?](#how-do-the-groovy-sandbox-script-approval-and-pull-requests-define-trust)
4. [How Do OIDC Claims and Cloud Policies Replace Static Keys?](#how-do-oidc-claims-and-cloud-policies-replace-static-keys)
5. [Why Do Jenkins Pipelines Need Two Sandboxes?](#why-do-jenkins-pipelines-need-two-sandboxes)
6. [Why Are Secret Management and Authorization Different?](#why-are-secret-management-and-authorization-different)
7. [How Should Pull-Request and Release Paths Be Separated?](#how-should-pull-request-and-release-paths-be-separated)
8. [How Does the Complete Jenkins Security Chain Fit Together?](#how-does-the-complete-jenkins-security-chain-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Jenkins sits in a powerful position. It checks out source code, builds artifacts, pushes images, deploys to clusters, publishes release notes, and sometimes talks to cloud accounts. To do that work, it often needs secrets: registry passwords, SSH keys, API tokens, cloud credentials, kubeconfig files, signing keys, and webhook tokens.

The platform team learns this through a simple mistake. A developer adds `docker login -u company -p super-secret` to a shell step during a late release. Jenkins prints commands and logs to the build console, so the password lands in a place many engineers can read. The security team rotates the registry credential, but the bigger lesson is about boundaries.

A **credential** in Jenkins is a stored secret or identity material that jobs can use without hardcoding the value in a Jenkinsfile. Jenkins stores credentials through its credentials system, and jobs refer to them by a `credentialsId`. The Jenkinsfile should know the ID and the scope of use, while the raw secret value stays in the credentials store or an external secret provider.

Keep these questions in view as you work through the lesson:

1. **How Do Jenkins Credentials Store and Transfer Authority?**
2. **What Do Quoting, Files, Agents, and Masking Protect or Expose?**
3. **How Do the Groovy Sandbox, Script Approval, and Pull Requests Define Trust?**
4. **How Do OIDC Claims and Cloud Policies Replace Static Keys?**
5. **Why Do Jenkins Pipelines Need Two Sandboxes?**
6. **Why Are Secret Management and Authorization Different?**
7. **How Should Pull-Request and Release Paths Be Separated?**
8. **How Does the Complete Jenkins Security Chain Fit Together?**

## How Do Jenkins Credentials Store and Transfer Authority?
<!-- section-summary: Jenkins credentials need storage boundaries, runtime boundaries, author trust boundaries, and branch boundaries. -->

Jenkins normally encrypts stored credential values using key material under `$JENKINS_HOME`, but that is a storage boundary, not magic isolation from the controller. A controller administrator, privileged plugin, trusted script, or compromised controller process may be able to obtain or use credentials. Protect controller storage, backups, plugin code, administrator access, and encryption keys as one system.

A credential ID such as `registry-prod-push` is only a reference. It is safe to place the ID in a Jenkinsfile because possession of the name does not reveal the value. At runtime Jenkins resolves that ID within the job's accessible credential scope. Place credentials at the smallest useful global, folder, system, or domain boundary rather than making every job eligible by default.

There are four boundaries to think about:

| Boundary | Question it answers | Jenkins mechanism |
|---|---|---|
| Storage boundary | Where does the secret value live? | Jenkins credentials store, external secret manager, JCasC references |
| Runtime boundary | Which step receives the secret? | `withCredentials`, scoped environment variables, isolated agents |
| Author boundary | Who can write code that uses the secret? | Job permissions, repository permissions, script sandbox, trusted libraries |
| Branch boundary | Which branch or PR can reach the secret? | Multibranch trust settings, `when` gates, credential scope |

The rest of the article follows those boundaries. First the team binds credentials into a build safely. Then they look at masking, because masking is useful but limited. After that they cover Groovy sandboxing, untrusted pull requests, and the move from static cloud keys to OIDC federation.

Jenkins participates in several kinds of identity. Human users authenticate to the controller and receive Jenkins permissions. Agents authenticate so they can accept work. Jenkins uses source-control credentials to scan and check out repositories. Pipeline steps receive service credentials for registries, clouds, clusters, and APIs. OIDC lets a build present a workload identity to an external provider. These identities solve different trust relationships and should not share one broad credential by convenience.

The first principle is that a secret represents transferable authority. A registry password is the ability to publish or overwrite images. An SSH key is the ability to act as its remote account. An API token inherits the scopes granted to its principal. Risk increases with both the authority and the time or surface over which it is exposed:

```text
security risk grows with authority × exposure time
```

A narrowly permitted five-minute role session and an administrator key valid for a year are both credentials, but they create very different incident boundaries. Minimize power, duration, number of jobs, number of people who can change those jobs, and number of machines on which the credential appears.

![Jenkins credential boundaries showing storage boundary, credentials store, runtime boundary, withCredentials, author boundary, script approval, branch boundary, and trusted branch only](/content-assets/articles/article-cicd-jenkins-credentials-and-security/jenkins-credential-boundaries.png)

*Jenkins credential safety comes from several boundaries lining up: where the secret lives, when a step receives it, who can write that step, and which branch can reach it.*

<!-- section-summary: Credentials binding gives one pipeline block temporary environment variables or files that reference stored Jenkins credentials. -->

The **Credentials Binding plugin** gives pipelines a step called `withCredentials`. This step takes a stored Jenkins credential, exposes it to a small block as an environment variable or temporary file, and removes that binding after the block finishes. The Jenkinsfile uses the credential ID, while Jenkins handles the secret value at runtime.

The platform team stores a Docker registry username and password as a Jenkins credential with ID `registry-prod-push`. The publish stage can bind that credential only around the `docker login` and `docker push` commands:

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
                printf '%s' "$REGISTRY_PASSWORD" | docker login registry.company.example -u "$REGISTRY_USER" --password-stdin
                docker push "$IMAGE"
            '''
        }
    }
}
```

The stage has three useful controls. The `when` block keeps publishing on `main`. The `withCredentials` block keeps the registry secret inside one narrow scope. The shell uses `--password-stdin`, so the password travels through standard input instead of appearing as a command-line argument.

The verification path should prove the credential works without printing it. A staging publish job can push a harmless image tag, then the operator checks the registry for that tag and confirms the Jenkins log contains no raw username, password, or token output. That kind of check tests the real integration while keeping the secret value out of the evidence.

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
        GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes" git fetch git@github.com:company/private-release-data.git
    '''
}
```

The binding gives the shell a temporary key file path. Jenkins deletes the temporary file after the block completes. The agent still matters, because any process running as the same operating-system user during that window may have opportunities to inspect environment or process data. Sensitive jobs deserve isolated agents or single-executor agents, especially when teams run code from many repositories.

The binding lifecycle is deliberate: resolve the ID, materialize a value or temporary file on the selected agent, expose its reference only inside the block, mask recognized console forms, then remove the binding and temporary material. It cannot undo network calls already made or files copied elsewhere. Code inside the block must already be trusted to exercise that authority.

## What Do Quoting, Files, Agents, and Masking Protect or Expose?
<!-- section-summary: Runtime representation determines whether a secret leaks through Groovy interpolation, process arguments, shared environments, workspaces, or neighboring jobs. -->

Quoting decides which layer expands a value. A double-quoted Groovy string interpolates `${TOKEN}` while Jenkins is preparing the step, before the shell starts. That can place the value in Pipeline metadata or the operating-system command line. A single-quoted or triple-single-quoted Groovy string passes `$TOKEN` to the shell for expansion inside the process environment, giving masking and shell controls a better chance to work.

Environment variables are convenient interfaces, not vaults. Other processes running as the same account may inspect process environments on some systems. A child process inherits variables unless the caller removes them. Debuggers, crash reports, shell tracing, and diagnostic commands can reveal them. Keep the binding block short and avoid running unrelated tools while sensitive variables exist.

Secret files add a filesystem boundary. Jenkins may create a temporary file and put its path in an environment variable. Be careful about workspace layout: a secret file placed beneath a browsable workspace could be exposed through artifact archiving, workspace browsing, or a later job. Bind before changing into a subdirectory when that keeps the temporary directory outside the visible workspace, and never archive broad globs that may include secret material.

An ephemeral agent is a security feature because it limits persistence after the block. The agent starts from a controlled image, runs one build, and disappears with its environment and filesystem. This does not stop exfiltration while the job runs, but it reduces cross-build residue, malicious persistence, and later access to a forgotten file.

Persistent multi-executor agents increase sharing. Two builds can run under the same operating-system account, use neighboring workspaces, and overlap in time. Production credentials belong on dedicated, low-concurrency, tightly authorized capacity rather than a general worker that also executes pull requests.

`set +x` turns off shell command tracing, which prevents one common accidental echo. It does not remove the environment variable, block network access, protect process arguments, prevent a program from reading the file, or stop explicit output. Use it as one hygiene control, not the security boundary.

<!-- section-summary: Masking reduces accidental console leaks, while credential scope and trusted authors provide the real security boundary. -->

When Jenkins binds a secret, it tries to mask matching secret values in the build log. If a tool prints the registry password, Jenkins may replace it with `****`. This protects against common accidents, such as a shell command echoing an environment variable or a CLI showing a token in normal output.

Masking has limits because a pipeline author who can use a credential can usually send it somewhere on purpose. The author can base64-encode it, split it into pieces, write it to a file artifact, send it to a network endpoint, or run a tool that hides the value from the log but still exfiltrates it. Jenkins log masking helps with accidental exposure; the stronger control is deciding which jobs, branches, authors, and agents can access the credential at all.

Masking is pattern recognition. Jenkins knows literal secret forms and some common shell-mangled representations, then replaces matches in captured console output. It cannot recognize every reversible transformation, every byte stream sent to another destination, or data written outside the console path. A value split into characters or encoded before printing may no longer match the patterns Jenkins knows.

There is also a shell detail that matters. In Groovy, double-quoted strings can interpolate variables before the shell receives the script. In many cases, single-quoted Groovy strings or triple single-quoted shell blocks keep expansion inside the shell, which reduces the chance that Jenkins stores the secret in step metadata or process arguments.

This pattern keeps the shell responsible for expansion:

```groovy
withCredentials([string(credentialsId: 'service-api-token', variable: 'API_TOKEN')]) {
    sh '''
        set +x
        curl -H "Authorization: Bearer $API_TOKEN" https://api.example.com/release
    '''
}
```

This pattern expands in Groovy before the shell runs, which creates extra exposure in process listings and Jenkins step metadata:

```groovy
withCredentials([string(credentialsId: 'service-api-token', variable: 'API_TOKEN')]) {
    sh """
        curl -H "Authorization: Bearer ${API_TOKEN}" https://api.example.com/release
    """
}
```

Masking also struggles with tools that transform output. A command can print a URL-encoded token, a JSON-escaped token, a wrapped line, or a debug dump with partial values. The team should still set `set +x`, avoid debug logs around secrets, keep credentials out of command-line arguments where possible, and run secret-using steps on agents that untrusted jobs cannot share.

The simple review question is this: who can change the code inside the `withCredentials` block? If that answer includes fork contributors, broad repository write access, or any pipeline author outside the trusted deployment group, the credential scope is too wide for production deploy power.

![Runtime secret scope showing withCredentials block, secret enters here, docker login, docker push, secret removed after block, masked logs, and do not echo secrets](/content-assets/articles/article-cicd-jenkins-credentials-and-security/runtime-secret-scope.png)

*`withCredentials` narrows where the secret appears, but the real safety check is still who can edit that block and which agent runs it.*

## How Do the Groovy Sandbox, Script Approval, and Pull Requests Define Trust?
<!-- section-summary: The Groovy sandbox limits which Jenkins and Java APIs untrusted pipeline code can call. -->

Jenkins Pipeline executes Groovy, and Groovy can be very powerful. A script with wide access could try to read files, call Java APIs, inspect Jenkins internals, or change controller behavior. Jenkins uses the **Script Security plugin** to reduce that risk through the **Groovy sandbox** and **script approval**.

The **Groovy sandbox** allows common pipeline operations while blocking method calls that Jenkins has not approved for sandboxed scripts. When a pipeline tries to call a restricted method, Jenkins stops the script and records a pending approval item. An administrator can review the requested signature in Manage Jenkins, In-process Script Approval.

This matters for shared libraries and Jenkinsfiles. A normal application Jenkinsfile usually runs in the sandbox. A folder-level shared library also runs in the sandbox. A trusted global library can run outside those restrictions, so that library repository needs stricter review and branch protection than a normal application repository.

Here is the practical review path. If a sandbox rejection appears, the team should ask why the pipeline needs that API. A normal application build rarely needs direct access to Jenkins controller internals. The safer fix often moves the operation into a supported pipeline step, a CLI on an agent, or a narrow trusted shared-library function owned by the platform team.

Approving signatures by habit weakens the boundary. Each approval lets sandboxed pipeline code call more powerful APIs in the future. A useful approval record should mention which job needed it, why a normal step could not do the work, which data the method can reach, and whether a trusted shared-library wrapper would be safer.

The sandbox connects back to credentials. If a Jenkinsfile can call unusual APIs and also bind production credentials, a small review miss can grow into a serious incident. Strong Jenkins security combines sandbox defaults, careful approvals, restricted credential scopes, and isolated agents.

The sandbox controls Groovy method calls in the Jenkins execution model. It does **not** sandbox operating-system commands started with `sh`, `bat`, or another Pipeline step. Once a permitted step launches `bash`, `npm`, Docker, or a deployment tool on an agent, operating-system and container isolation must control that process. Sandbox approval cannot make a privileged agent safe for hostile shell code.

Script Approval can approve a whole script outside the sandbox or approve individual method signatures. Both are authorization decisions. A signature may look harmless but expose data or mutate Jenkins when called on a sensitive receiver. Permission-aware approvals exist because some getters are safe only when Jenkins performs the normal permission check; approving a lower-level bypass can accidentally remove that check.

Trusted Shared Libraries are especially powerful. Their code can run outside the sandbox and call Jenkins internals, so they are part of the controller's trusted computing base. Protect the library repository with limited maintainers, required review, pinned consumer versions, and auditable releases. Do not move arbitrary application logic into a trusted library merely to silence sandbox errors.

<!-- section-summary: A pull request can change pipeline code, so fork trust settings and credential gates decide whether secrets stay protected. -->

Multibranch Pipeline makes Jenkins convenient because every branch or pull request can bring its own Jenkinsfile. That same feature creates a security question. If a fork contributor can edit a Jenkinsfile, and Jenkins runs that file with production credentials, the pull request can try to steal the credential.

The platform team has a public repository for a small SDK. A contributor opens a pull request that changes a test script. If the PR job receives the Docker registry credential, the contributor can modify the test to print or send the secret. Log masking might hide a direct print, but it cannot turn an untrusted pipeline author into a trusted one.

Branch source plugins provide trust settings for pull requests from forks. The exact labels depend on the SCM plugin, but the security idea stays the same:

| Trust choice | What usually happens | Good fit |
|---|---|---|
| Trust nobody from forks | Jenkins uses maintainer-controlled pipeline logic for fork PRs | Public repositories and broad contributor bases |
| Trust known contributors | Jenkins trusts PR pipeline code from recognized contributors | Private or semi-open projects with clear membership |
| Trust everyone | Jenkins runs fork-provided pipeline code as trusted | Rare internal setups with tightly controlled forks |

For public repositories, the platform team keeps fork PR builds on a safe path. PRs compile, lint, and test without production credentials. Deployment stages run only after reviewed code reaches `main`. Registry push credentials live in a folder or credential domain that only trusted jobs can access, and the Jenkinsfile still uses branch gates as a second control.

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

“The Jenkinsfile is trusted” is not sufficient if it checks out and executes attacker-controlled source. A maintainer-owned Jenkinsfile can still run `npm test`, `mvn test`, `make`, or a repository script from the pull request. That code can read any credential or network authority already present on the agent. Trust analysis must include every executable input, not only the Pipeline file.

A safer pull-request architecture uses an unprivileged job and agent pool. It checks out the proposed revision, compiles, tests, and reports results with no deploy credentials and no production network access. After review and merge, a separate trusted branch job builds or verifies the merged commit, publishes an artifact, and performs release work under narrower authorization.

Multibranch trust policies help determine whether a fork's Jenkinsfile or a maintainer-controlled definition governs the run, but they only solve part of the problem. They do not make the fork's application code trustworthy, remove dependency lifecycle hooks, or stop a trusted definition from executing an untrusted script. Credentials, agent isolation, network boundaries, and merge-only release jobs are still required.

SCM scan credentials have their own trap. They may be configured only to discover repositories, but job inheritance or checkout configuration can make them available more broadly than intended. Use the smallest read-only credential for indexing, separate status-writing and checkout identities when useful, and never reuse a deployment credential for repository discovery.

## How Do OIDC Claims and Cloud Policies Replace Static Keys?
<!-- section-summary: OIDC federation lets Jenkins exchange short-lived build identity tokens for cloud credentials instead of storing long-lived access keys. -->

Many Jenkins installations start with static cloud keys. An administrator creates an AWS IAM user named `jenkins-deploy`, stores the access key and secret access key in Jenkins, and uses them to deploy. That works, but the key can live for months, and every rotation requires coordination across Jenkins, cloud IAM, and every pipeline that expects the credential.

The fundamental problem is not only storage. A static key has one identity and permission set, remains useful between builds, and can be copied away from Jenkins. Rotation changes the shared password but keeps the same model. Temporary credentials improve the exposure window, while workload identity also lets the provider decide authority from facts about this particular job.

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
        "Federated": "arn:aws:iam::123456789012:oidc-provider/jenkins.company.example/oidc"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "jenkins.company.example/oidc:aud": "sts.amazonaws.com",
          "jenkins.company.example/oidc:sub": "https://jenkins.company.example/job/service/job/main/"
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
        'AWS_ROLE_ARN=arn:aws:iam::123456789012:role/service-prod-deploy',
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

The first OIDC rollout should fail closed during testing. The platform team runs the job once with the expected Jenkins job path and confirms `aws sts get-caller-identity` returns the production deploy role. Then they run a non-production job path against the same role and expect AWS to deny the call. That negative test proves the trust policy is checking the subject claim instead of trusting every Jenkins token from the issuer.

OIDC dramatically changes the secret lifecycle. Jenkins protects an issuer signing capability, then produces a short-lived token for one build. The external service validates that token and creates a still-short-lived role session. The pipeline no longer retrieves a reusable cloud password that must be rotated everywhere. Revocation and narrowing happen through issuer trust, claim conditions, and role policy.

OIDC does not make untrusted Pipelines safe. A malicious process that can request or read the job token can exchange it while it is valid and use the resulting role. Federation shortens duration and improves identity, but code trust, agent isolation, and least privilege still decide whether the capability is exposed appropriately.

<!-- section-summary: OIDC authenticates a build through signed claims, while the external trust policy and role permissions make separate authorization decisions. -->

OIDC is authentication first: it lets the external provider verify “this token came from the configured Jenkins issuer and describes this build.” The provider still has to authorize that identity. In AWS, the role trust policy decides whether the claims may call `AssumeRoleWithWebIdentity`; the role permission policy decides what the resulting session can do.

Follow the exchange physically:

```text
Jenkins build requests ID token
  -> issuer creates signed token with claims
  -> build presents token to AWS STS
  -> STS validates issuer, signature, expiry, and audience
  -> role trust policy evaluates subject and other conditions
  -> STS returns temporary role credentials
  -> AWS permissions policy bounds API operations
```

Claims matter because they turn one issuer into multiple workload identities. `sub` can identify a particular Jenkins job path, and other configured claims can distinguish branch, build, or context. If the trust policy checks only the issuer, every job able to obtain a token from that controller may become eligible for the same role.

The `aud` claim states which recipient the token is intended for. AWS commonly expects `sts.amazonaws.com`. Without an audience check, a token minted for one relying party might be replayed to another that trusts the same issuer. Audience, subject, signature, and expiry solve different validation questions.

Think in **capabilities**, not password names. The useful review statement is “this merged release job can obtain a five-minute role that updates this one service,” not “this job has the AWS credential.” Identity claims describe the job, trust grants the role, role permissions define the capability, and session duration bounds its lifetime.

## Why Do Jenkins Pipelines Need Two Sandboxes?
<!-- section-summary: Groovy sandboxing protects controller APIs, while operating-system or container isolation protects agents from the commands Pipeline launches. -->

Jenkins needs two different isolation layers. The Groovy sandbox constrains access to controller-side Java and Jenkins APIs. An execution sandbox constrains processes on the agent: filesystem, network, kernel capabilities, devices, neighboring jobs, and persistence. One cannot replace the other.

The controller should not be a build agent because it collapses both layers. A permitted `sh` step would execute beside `$JENKINS_HOME`, controller credentials, plugin state, and the scheduler. Set controller executors to zero and send builds to controlled agents. Use disposable VMs, containers, Kubernetes pods, or another isolation technology appropriate to the threat level.

For low-trust pull requests, the execution sandbox should have no production route, no host Docker socket, no shared deploy workspace, no cloud instance identity, and no production secret. For releases, a dedicated agent can have a narrow route and temporary workload identity. Both may run sandboxed Groovy, but their operating-system capabilities are intentionally different.

Ephemerality handles state after execution; network and credential scope handle power during execution. A disposable privileged pod is still privileged while alive. Security comes from combining the lifecycle with least capability.

## Why Are Secret Management and Authorization Different?
<!-- section-summary: A vault or Jenkins store protects values, while authorization decides which people, jobs, branches, and code paths may exercise the represented capability. -->

Secret management answers how a value is stored, encrypted, rotated, injected, and audited. Authorization answers whether this principal or workload may receive or exercise the represented power. Moving an administrator key from a Jenkins credential to an external vault improves storage operations but does not make the job least-privileged if every branch can request it.

A useful hierarchy is:

```text
trust the code and author
  -> authorize the job and branch
  -> select an isolated agent capability
  -> release the smallest credential or workload identity
  -> external policy grants narrow operations
  -> remove short-lived runtime material
  -> retain an audit record
```

The layers prevent different failures. Repository review protects the program. Jenkins permissions and multibranch policy protect job configuration. Credential scope protects availability. Binding protects runtime breadth. Agent isolation protects the execution boundary. Cloud trust and permissions protect the target. Masking protects logs from common accidents.

This is also why simply “using Vault” or “using OIDC” cannot finish the security design. The important question is who can cause which code to receive which capability on which machine.

## How Should Pull-Request and Release Paths Be Separated?
<!-- section-summary: Pull requests should prove proposed code without authority, while release jobs should consume trusted merged code and obtain narrow temporary capability. -->

A strong pull-request path runs on isolated ephemeral capacity, checks out the proposed revision, installs dependencies, compiles, tests, and scans. Its SCM token is read-only, it has no deployment credentials, and its network cannot reach production. Results return as status and logs.

After merge, a trusted main-branch path builds the exact merged commit or verifies a promoted artifact. A separate release stage or job receives explicit human or policy authorization, runs on a release-capable agent, and obtains a short-lived registry, signing, or cloud identity. The release output is tied to the tested revision rather than rebuilding arbitrary pull-request code inside the privileged boundary.

On merge, do not assume that the pull-request result alone authorizes release: the merge commit may differ, base branch state may have moved, and the trusted release policy may require different checks. Re-run or verify the required checks on the trusted revision, publish immutable outputs, and promote those outputs through the release boundary.

This design separates **proof** from **power**. Pull requests prove that proposed code meets quality expectations. Release automation exercises production power only after source trust, merge state, policy, agent, and external authorization align.

## How Does the Complete Jenkins Security Chain Fit Together?
<!-- section-summary: Jenkins security works when storage, runtime scope, author trust, branch trust, and cloud identity all line up. -->

The final Jenkins setup has layered boundaries. Secrets live in Jenkins credentials or an external secret provider. Jenkinsfiles bind those credentials only inside narrow `withCredentials` blocks. Shell steps use `set +x`, stdin, and environment expansion patterns that reduce accidental leaks. Sensitive jobs run on isolated agents.

The team also controls who can write secret-using code. Application Jenkinsfiles stay sandboxed. Trusted shared libraries live in protected repositories. Script approvals receive real review. Public pull requests run tests without production credentials. Deploy stages wait for trusted branches and explicit release intent.

For cloud deployments, the team starts moving from static keys to OIDC federation. Jenkins issues a build identity token, AWS exchanges it for temporary role credentials, and role trust conditions tie that access to a specific job path and audience. The pipeline still uses Jenkins credentials binding, but the credential now represents a short-lived identity flow instead of a long-lived secret.

That completes the Jenkins module. The architecture gives the controller and agents a clean boundary. Jenkinsfiles make delivery reviewable. Shared libraries reduce repeated pipeline code. Plugins and Configuration as Code make the controller rebuildable. Credentials and security keep the deploy power inside Jenkins scoped to the people, branches, jobs, and runtimes that should have it.

Threat-model a sensitive stage with a fixed set of questions. Who can change the Jenkinsfile, shared library, scripts, and dependencies? Which controller APIs and operating-system capabilities can that code reach? Which credential IDs can the job resolve? On which agent does the binding appear, and what other processes share it? What network targets are reachable? Which external policy limits the identity, and how long does it live? What evidence will show that it was used?

Move from static secrets to workload identity incrementally. Inventory each long-lived key and its real operations. Create a narrow role and issuer trust, add an OIDC token binding to a non-production job, verify positive and negative claim cases, migrate production under a controlled release, then revoke the static key. Keep a stored secret only when the target cannot accept federated identity, and apply the same smallest-scope rule.

![Federated deploys showing static key long-lived risk compared with identity token, trust check, short-lived role, deploy, audit record, and scoped access](/content-assets/articles/article-cicd-jenkins-credentials-and-security/federated-deploys-summary.png)

*The final security direction is to reduce long-lived deploy secrets and use scoped, auditable, short-lived identity flows wherever the Jenkins installation can support them.*

## Check Your Answers

:::expand[How Do Jenkins Credentials Store and Transfer Authority?]{kind="recap"}
A credential lets its possessor exercise the permissions of an identity. Jenkins uses separate human, agent, SCM, service, and workload identities. Reduce risk by narrowing authority, lifetime, eligible jobs and authors, and the machines on which each credential appears.

The store protects values before use, while a credential ID is only a reference. `withCredentials` resolves an accessible ID, materializes a value or file on an agent for one block, masks recognized console forms, and removes the binding afterward. Code in the block can still use the authority.
:::

:::expand[What Do Quoting, Files, Agents, and Masking Protect or Expose?]{kind="recap"}
Groovy interpolation can expose values before the shell runs. Environment variables and files are runtime interfaces, not vaults. Keep scopes short, files outside browsable workspaces, tracing off, and sensitive jobs isolated. Ephemeral workers reduce residue but not live exfiltration.

Masking recognizes literal and some transformed secret patterns in captured logs, which helps prevent accidents. It cannot identify arbitrary encoding, stop artifacts or network calls, or restrain an author deliberately using the value. Authorization and runtime scope are the real boundary.
:::

:::expand[How Do the Groovy Sandbox, Script Approval, and Pull Requests Define Trust?]{kind="recap"}
The sandbox limits Jenkins and Java method calls from Groovy. Script Approval widens that API authority and requires careful review. It does not sandbox commands on agents. Trusted Shared Libraries bypass more restrictions and therefore belong to the controller's tightly protected trusted codebase.

A pull request can change Jenkinsfile logic, scripts, dependencies, and test commands. Even a maintainer-owned Jenkinsfile may execute attacker-controlled code. Use unprivileged agents and identities, multibranch trust policy, narrow SCM credentials, and merge-only release jobs.
:::

:::expand[How Do OIDC Claims and Cloud Policies Replace Static Keys?]{kind="recap"}
Static keys are reusable authority that persists between builds and creates rotation burden. OIDC lets Jenkins mint a short-lived identity token that a provider exchanges for temporary credentials. It reduces lifetime and improves workload identity but does not make hostile code safe.

The signed token authenticates the Jenkins workload. Audience identifies the intended recipient, subject distinguishes the job, the trust policy authorizes role assumption, and the role policy authorizes cloud operations. Validate both allowed and denied identities.
:::

:::expand[Why Do Jenkins Pipelines Need Two Sandboxes?]{kind="recap"}
Groovy sandboxing protects controller APIs. VM, container, pod, filesystem, kernel, and network controls protect agent execution. Keep the controller at zero executors, run untrusted work without powerful capabilities, and remember that a disposable privileged worker is still privileged while alive.
:::

:::expand[Why Are Secret Management and Authorization Different?]{kind="recap"}
Secret management handles storage, encryption, rotation, injection, and audit. Authorization decides which code and workload may exercise the capability. Vaults, credentials binding, agent isolation, job permissions, cloud trust, and role policy protect different links in the chain.
:::

:::expand[How Should Pull-Request and Release Paths Be Separated?]{kind="recap"}
Pull requests prove proposed code on isolated low-authority workers. After merge, verify the trusted revision, produce immutable outputs, and let a distinct authorized release job obtain narrow temporary capability. This separates quality proof from production power.
:::

:::expand[How Does the Complete Jenkins Security Chain Fit Together?]{kind="recap"}
Trusted source and library code, sandboxed orchestration, authorized jobs, isolated agents, scoped binding, short-lived identity, external trust, narrow permissions, and audit evidence must align. Migrate static keys one capability at a time, prove allowed and denied cases, then revoke them.
:::

## References

- [Jenkins: Credentials](https://www.jenkins.io/doc/book/security/credentials/) - Explains Jenkins credentials, credential scope, and secret protection guidance.
- [Jenkins Credentials Binding plugin](https://plugins.jenkins.io/credentials-binding/) - Documents credentials binding, environment variable use, and automatic masking behavior.
- [Jenkins Pipeline Steps: Credentials Binding](https://www.jenkins.io/doc/pipeline/steps/credentials-binding/) - Provides `withCredentials` syntax, binding types, masking caveats, and environment-variable warnings.
- [Jenkins: In-process Script Approval](https://www.jenkins.io/doc/book/managing/script-approval/) - Explains the Groovy sandbox and administrator script approval flow.
- [Jenkins: Securing SCM credentials for Organization Folders and Multibranch Pipelines](https://www.jenkins.io/doc/book/security/securing-org-folders-and-multibranch-pipelines/) - Documents trust risks when Jenkinsfiles can use credentials in multibranch jobs.
- [Jenkins: Controller Isolation](https://www.jenkins.io/doc/book/security/controller-isolation/) - Explains agent-to-controller access control and controller isolation from build execution.
- [Jenkins OpenID Connect Provider plugin](https://plugins.jenkins.io/oidc-provider/) - Documents Jenkins-issued OIDC ID tokens for keyless authentication to external systems.
- [AWS IAM: OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html) - Explains OIDC federation and temporary AWS credentials for CI/CD workloads.
- [AWS IAM: Create a role for OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html) - Documents OIDC provider trust policies and `sts:AssumeRoleWithWebIdentity`.
