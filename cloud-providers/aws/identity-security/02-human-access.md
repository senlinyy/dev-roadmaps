---
title: "Access for People and Applications"
description: "Use IAM Identity Center, IAM roles, STS sessions, and runtime credential delivery so people and workloads can use AWS without permanent keys."
overview: "After the IAM overview, the next question is how access is received. This article follows humans, applications, containers, servers, and CI/CD workflows as they get temporary AWS access through Identity Center and IAM roles."
tags: ["iam", "identity-center", "roles", "credentials"]
order: 2
id: article-cloud-providers-aws-identity-security-human-access
aliases:
  - human-access
  - access-for-people-and-applications
  - iam-identity-center
  - aws-sso
  - aws-iam-human-access
  - identity-center-human-access
  - workload-roles
  - workload-access-and-temporary-credentials
  - temporary-credentials-and-role-assumption
  - article-cloud-providers-aws-identity-security-workload-roles
  - cloud-providers/aws/identity-security/human-access.md
  - cloud-providers/aws/identity-security/02-human-access.md
  - cloud-providers/aws/identity-security/workload-roles.md
  - cloud-providers/aws/identity-security/03-workload-roles.md
  - cloud-providers/aws/identity-security/workload-access-and-temporary-credentials.md
  - cloud-providers/aws/identity-security/temporary-credentials-and-role-assumption.md
---

## Table of Contents

1. [A Caller Needs Its Own Path](#a-caller-needs-its-own-path)
2. [Human Access Through Identity Center](#human-access-through-identity-center)
3. [Permission Sets and Account Assignments](#permission-sets-and-account-assignments)
4. [CLI Sessions Without Static Keys](#cli-sessions-without-static-keys)
5. [Application Access With IAM Roles](#application-access-with-iam-roles)
6. [Runtime Credential Delivery](#runtime-credential-delivery)
7. [CI/CD and External Workloads](#cicd-and-external-workloads)
8. [MFA and Emergency Access](#mfa-and-emergency-access)
9. [Read the Caller During Incidents](#read-the-caller-during-incidents)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## A Caller Needs Its Own Path
<!-- section-summary: AWS access starts with the caller, because people, applications, servers, and pipelines need different credential paths. -->

Every useful AWS action begins with a signed request. The signature tells AWS which **caller** is asking to read an object, write a database item, deploy a function, or change a production setting. A caller might be a person using the console, a laptop running the AWS CLI, a Lambda function processing an event, an ECS task serving an API, an EC2 instance running a repair script, or a deployment workflow pushing a new release.

The running example in this article is an image-sharing application. Engineers support the service, a Lambda function creates thumbnails, an ECS service reads image metadata from DynamoDB, an EC2 instance runs occasional batch repair jobs, and GitHub Actions deploys new versions. Lambda runs code without you managing servers. ECS runs containers. EC2 provides virtual machines. DynamoDB is AWS's managed table-like database. GitHub Actions is a CI/CD system, which means it runs automated build, test, and deployment workflows.

A small demo can begin with one IAM user access key copied into every place that needs AWS. An **access key** is a pair of long-lived secret values used by the AWS CLI, SDKs, scripts, and applications to sign AWS API requests. The key often starts in a local file like this:

```dotenv
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
```

That key can make the first upload test succeed, and then it can quietly spread into a laptop, a container image, a CI/CD secret, a `.env` file, and a debugging screenshot. If the key leaks, CloudTrail records activity against the IAM user behind that key. CloudTrail is AWS's activity record for API calls, and its evidence becomes harder to read when the same permanent key was used by a human shell, application code, and a deployment job.

Different callers have different lifetimes. A person joins a team, changes teams, and eventually leaves. A laptop gets replaced. A Lambda function may run for seconds. A container task may be replaced several times a day. A deployment workflow should have production access only during the deployment window. One permanent key ignores those lifetimes and makes cleanup a manual hunt.

The safer access model separates the callers and lets each caller receive credentials from the system that already knows who they are. The shape looks like this:

| Caller | Normal access path | Permanent AWS key? |
|---|---|---:|
| Human engineer | IAM Identity Center account session | No |
| Local CLI user | Identity Center profile and cached session | No |
| Lambda function | Lambda execution role | No |
| ECS task | ECS task role | No |
| EC2 instance | Instance profile role | No |
| EKS workload | Pod Identity or service-account role | No |
| GitHub Actions workflow | OIDC federated role | No |
| Legacy vendor tool | Narrow IAM user exception | Sometimes |

The repeated pattern is **temporary credentials**. Temporary credentials are short-lived AWS credentials that expire automatically. AWS Security Token Service, usually shortened to **STS**, issues those credentials when a trusted caller assumes a role or uses federation. **Federation** means AWS trusts identity proof from another system, such as a company identity provider, Kubernetes, a CI/CD platform, or a certificate authority.

![Static key spread compared with separate temporary AWS sessions for engineers, applications, EC2, and CI/CD workflows](/content-assets/articles/article-cloud-providers-aws-identity-security-human-access/static-key-vs-temporary-sessions.png)

*The important shift is from one reusable secret copied into many places to separate temporary sessions created for the caller that actually needs AWS access.*

Human access is the first practical place to apply this pattern because people are usually where static keys begin spreading. Once people receive temporary access cleanly, the same idea becomes easier to apply to applications and automation.

## Human Access Through Identity Center
<!-- section-summary: IAM Identity Center gives workforce users one sign-in path into assigned AWS accounts instead of separate daily IAM users in each account. -->

**IAM Identity Center** is AWS's workforce access service. It lets people sign in through one trusted identity source, choose the AWS accounts they are allowed to enter, and receive temporary role sessions for the jobs assigned to them. An **identity source** is the directory of people and groups AWS trusts for workforce sign-in, such as the built-in Identity Center directory, Microsoft Entra ID, Okta, Active Directory, or another supported identity provider.

This becomes important as soon as the image service has more than a few people. A new engineer needs development access on Monday. A senior engineer needs production read access while on call. A finance partner needs billing visibility. A contractor leaves the project on Friday. Those changes belong in the workforce directory and group assignments, where the company already handles joining, moving, and leaving.

The daily sign-in path stays small:

```mermaid
flowchart LR
    Person["Engineer"]
    Source["Company sign-in"]
    Center["IAM Identity Center"]
    Dev["image-dev"]
    Prod["image-prod"]
    Audit["security"]

    Person --> Source
    Source --> Center
    Center --> Dev
    Center --> Prod
    Center --> Audit
```

The engineer signs in through the company system. Identity Center then shows only the AWS accounts and access packages assigned to that engineer. Development access appears for daily work, production read-only access appears for support, and billing stays outside the normal path unless the person has that assignment.

An IAM user lives inside one AWS account and can have a long-lived password or access key. An Identity Center user signs in through the workforce system and receives a temporary account session. When a person leaves the company or leaves a group, they lose the ability to start new AWS sessions for that assignment.

Identity Center gives people the entrance into AWS. The next layer decides which account they can enter, which job they can perform there, and how long the session should last.

## Permission Sets and Account Assignments
<!-- section-summary: Groups, permission sets, and account assignments connect people to a specific job in a specific AWS account. -->

Identity Center account access is built from three simple pieces: a **group**, a **permission set**, and an **account assignment**. The group names the people. The permission set names the job. The account assignment connects that group and job to one AWS account.

A **permission set** is an access package such as `DeveloperAccess`, `ProductionReadOnly`, `SecurityAudit`, or `BillingView`. It contains IAM policies and a session duration. When Identity Center assigns a permission set to an account, AWS creates and manages an IAM role in that account for the assignment.

For the image-sharing application, the assignments might look like this:

| Group | Account | Permission set | Result |
|---|---|---|---|
| `aws-image-developers` | `image-dev` | `DeveloperAccess` | Build and test the service in development. |
| `aws-image-developers` | `image-prod` | `ProductionReadOnly` | Inspect production while supporting incidents. |
| `aws-platform-admins` | `image-prod` | `AdministratorAccess` | Perform rare production administration. |
| `aws-security-auditors` | all accounts | `SecurityAudit` | Review configuration and evidence. |
| `aws-billing-viewers` | billing account | `BillingView` | View cost data without infrastructure control. |

The first row means members of `aws-image-developers` can enter the `image-dev` account with the `DeveloperAccess` permission set. That assignment gives them development access through one role session. Production write access, billing access, and security administration require separate assignments.

Session duration belongs in the permission set because temporary credentials still work until they expire. For AWS account access through Identity Center, new permission sets default to one hour, and AWS supports permission set sessions up to twelve hours. A powerful production-admin session should usually be short. A weaker read-only audit session may be longer when the work requires it.

Offboarding now has a clear shape. Removing the person from the identity source or from the AWS group stops new sessions for that assignment. Existing sessions can continue until their configured duration ends, which is one reason powerful permission sets should avoid all-day sessions.

![IAM Identity Center routing workforce identities through permission sets into development, production, and billing AWS accounts](/content-assets/articles/article-cloud-providers-aws-identity-security-human-access/identity-center-account-assignments.png)

*Identity Center turns human AWS access into account assignments: the person comes from the identity source, the permission set describes the job, and the account decides where that job applies.*

People can now use the AWS Console through temporary sessions. Engineers also need terminal access because real support work often happens in scripts, infrastructure tools, and diagnostic commands.

## CLI Sessions Without Static Keys
<!-- section-summary: AWS CLI profiles can use Identity Center sessions, so daily terminal work uses temporary credentials. -->

Engineers rarely use only the browser. They run the AWS CLI, Terraform, SDK tools, deployment scripts, and diagnostic commands. The **AWS CLI** is the terminal tool for calling AWS APIs. Terraform is an infrastructure tool that creates and changes cloud resources from configuration files. An **SDK** is a programming library that lets application code call AWS.

The older local pattern stores permanent keys in `~/.aws/credentials`. This works mechanically, but it puts a long-lived AWS secret on the laptop:

```ini
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

That file can sit on the laptop for months. It may also end up in a backup, a copied home directory, a screen share, or a dotfiles repository. Rotating the key helps only after someone finds every place the old value was copied.

The Identity Center pattern stores profile instructions instead of AWS secrets. The file points the CLI at the right account and permission set, then the engineer signs in when they need a session:

```ini
[profile image-dev]
sso_session = company
sso_account_id = 111122223333
sso_role_name = DeveloperAccess
region = us-east-1
output = json

[sso-session company]
sso_region = us-east-1
sso_start_url = https://example.awsapps.com/start
sso_registration_scopes = sso:account:access
```

A normal support workflow signs in and checks the active caller before touching anything risky:

```bash
aws sso login --profile image-dev
aws sts get-caller-identity --profile image-dev
```

A healthy result shows an assumed role session. The important part is that the ARN names a temporary role session, not a permanent IAM user key:

```json
{
  "UserId": "AROA123456789EXAMPLE:Jordan",
  "Account": "111122223333",
  "Arn": "arn:aws:sts::111122223333:assumed-role/AWSReservedSSO_DeveloperAccess_a1b2c3d4e5f6/Jordan"
}
```

The `Arn` tells the engineer which role session the terminal is using and which account the next command will act on. That small check catches many wrong-account mistakes before a migration, deploy, or cleanup command changes real infrastructure. Human access now has a browser path and a terminal path, both based on temporary credentials.

The image application still needs AWS access while it runs. That is where workload roles enter the story.

## Application Access With IAM Roles
<!-- section-summary: IAM roles give running software temporary AWS access, so application code can call AWS without storing permanent keys. -->

Application code that calls AWS is holding real authority. It might read an S3 object, write a DynamoDB item, publish an SQS message, decrypt a secret, or update infrastructure if its credentials allow that. S3 is AWS object storage for files such as images, exports, reports, and backups. SQS is AWS's managed queue service for passing messages between systems.

The thumbnail Lambda function in the image application has a narrow job. It reads original images from one input bucket and writes resized images into one output bucket. If static access keys are pasted into function configuration, the function settings become a permanent secret store and CloudTrail activity points back to the copied key.

An **IAM role** gives the workload an AWS identity without a password or permanent access key. A role has two important policy parts. The **trust policy** says who may assume the role. The **permission policy** says what the role session may do after it has been assumed.

For a Lambda thumbnailer, the trust policy allows the Lambda service to assume the role. This policy answers the entry question for the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

The permission policy grants only the S3 access the function needs. This policy answers the action question after the role has been assumed:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::image-input-prod/uploads/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::image-output-prod/thumbs/*"
    }
  ]
}
```

Both policies matter. The trust policy lets Lambda enter the role. The permission policy lets the resulting role session read from the input path and write to the output path. If either side is missing, the function cannot complete the job.

This role belongs to the thumbnailer. The ECS image-metadata service should have its own role for DynamoDB reads. The EC2 repair worker should have its own role for the batch actions it performs. Each workload gets an identity that matches its job, and each identity can be inspected in CloudTrail when something behaves strangely.

Role design is only useful when the running code can receive the role credentials safely. The next practical detail is how AWS runtimes deliver those temporary credentials to application code.

## Runtime Credential Delivery
<!-- section-summary: AWS runtimes deliver role credentials through platform paths, so SDK code can use the standard credential provider chain. -->

The cleanest AWS application code creates a service client and lets the runtime plus SDK find credentials through the standard **credential provider chain**. A credential provider chain is the ordered list of places an AWS SDK or tool checks for credentials, such as environment variables, shared config files, Identity Center sessions, container endpoints, web identity tokens, process helpers, and EC2 instance metadata.

For Node.js, using the default chain can be this plain. The application asks for an S3 client, and the runtime supplies credentials through the provider chain:

```javascript
import { S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
```

The constructor stays empty because credentials come from the runtime environment. In Lambda, ECS, EC2, or EKS, the platform can expose temporary credentials for the role attached to that runtime. The SDK finds those credentials and refreshes them when the provider supports refresh.

A copied environment variable can still cause confusion. Environment variables are part of the credential provider story for many SDKs and tools, so an old `AWS_ACCESS_KEY_ID` can become the credential source even though a platform role also exists. The application may still work, but CloudTrail points at the static key and rotation becomes a manual problem again.

Each runtime has its own normal delivery path:

| Runtime | Role attachment | Credential path | Common mistake |
|---|---|---|---|
| EC2 | Instance profile | Instance Metadata Service | Using one server role for every app on the instance. |
| Lambda | Execution role | Lambda runtime credentials | Adding static keys to function settings. |
| ECS | Task role | Container credential endpoint | Confusing the task role with the task execution role. |
| EKS | Pod Identity or IRSA | Container credential provider | Letting pods fall back to the node role. |
| CI/CD | Federated role | Web identity token exchange | Trusting every workflow instead of one repo, branch, or environment. |

ECS has a split that deserves a careful look. The **task execution role** belongs to the ECS agent or Fargate platform. Fargate is the ECS option where AWS runs the container host for you. The execution role pulls private images, writes logs, and fetches startup secrets. The **task role** belongs to the application code inside the container. If the task cannot pull its image, the execution role is the likely place to inspect. If the application receives `AccessDenied` from S3 or DynamoDB, the task role is the likely place to inspect.

EKS has the same goal with Kubernetes-shaped pieces. With **EKS Pod Identity**, an IAM role can be associated with a Kubernetes service account, and pods using that service account receive credentials through the container provider path. **IRSA**, or IAM Roles for Service Accounts, is the older service-account role pattern many EKS teams still use. Both patterns let a payments pod and an image-thumbnail pod use different AWS identities even when they run in the same cluster. Pod-level identity also works best when access to the EC2 instance metadata service is restricted, so pods do not accidentally use the node role.

![AWS runtimes receiving temporary credentials through Lambda execution roles, ECS task roles, EC2 instance profiles, and EKS pod identity](/content-assets/articles/article-cloud-providers-aws-identity-security-human-access/runtime-role-credential-delivery.png)

*The role attachment changes by runtime, but the application goal stays the same: code asks the SDK for a client, and the platform supplies short-lived credentials for the right workload identity.*

The useful first question during a workload failure is which runtime identity actually made the AWS call. A policy change on the role you expected to use cannot fix a request that was signed by an old environment variable, a broad node role, or a different task role. The caller check moves the investigation from guesswork to evidence.

Applications inside AWS now have role-based access. Some important callers still run outside AWS.

## CI/CD and External Workloads
<!-- section-summary: External workloads can prove their identity through federation, so CI systems and outside platforms avoid AWS access keys. -->

A deployment workflow may run in GitHub Actions. A build agent may run in another cloud. A scanner may run in a data center. These callers still need AWS access, and copying an IAM user key into the outside system brings back the permanent-secret problem.

For CI/CD, the stronger pattern is **OIDC federation**. OIDC, or OpenID Connect, is a standard way for one system to prove identity to another. In a deployment workflow, an OIDC token can prove which organization, repository, branch, tag, or environment produced the run. AWS STS can exchange that proof for a temporary role session.

The production deploy role should trust the GitHub OIDC provider and then pin the caller to the intended repository and branch or environment. A compact trust policy looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:ExampleOrg/image-service:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Now the repository stores no AWS secret. The workflow receives temporary credentials only when the token matches the expected audience and subject. A feature branch, another repository, or a copied workflow from a different organization fails the trust check because the token facts do not match the conditions.

For servers outside AWS that cannot use OIDC, **IAM Roles Anywhere** can provide temporary credentials from certificate-based identity. A **certificate authority** is a system that signs certificates so other systems can verify identity. Roles Anywhere lets AWS trust a certificate authority as a trust anchor, map certificate identity to a role profile, and let a credential helper request temporary credentials for the outside workload.

Some legacy tools still support only long-term access keys. Treat those as exceptions with a named owner, a narrow policy, a rotation schedule, monitoring, and a review date. An exception should be easy to find because it is unusual, documented, and smaller than normal access.

Humans, workloads, and external automation now have temporary access paths. The remaining paths are the rare ones used when normal sign-in breaks or a high-risk recovery task has to happen.

## MFA and Emergency Access
<!-- section-summary: MFA protects normal human sign-in, while emergency access stays rare, monitored, and separate from daily work. -->

**Multi-factor authentication**, usually shortened to **MFA**, means sign-in requires a second proof beyond the password. That second proof may be a passkey, a hardware security key, or a one-time code. For AWS workforce access, MFA is usually handled by the identity source when a company uses an external identity provider.

Phishing-resistant MFA is strongest for AWS access. A passkey or hardware security key is bound to the real sign-in domain, so a fake login page has a much harder time collecting a reusable proof. One-time code apps are still much better than password-only sign-in, but they can be tricked in real time by a convincing proxy login flow.

Emergency access has a different purpose from daily administration. **Break-glass access** exists for failures in the normal identity system, account recovery, or rare administrator tasks that cannot wait for the usual path to be restored. A good break-glass plan has very few identities, strong MFA, controlled password storage, alerts on every sign-in, and regular tests so the emergency path works when it is needed.

Root stays outside daily work. The root user owns the account and may be needed for rare account-level recovery, so it should be locked away with MFA and no daily access keys. Emergency IAM users, if they exist, should be tightly scoped and tightly monitored. Identity Center is daily human access. Workload roles are daily software access. Break-glass is the tested exception.

Good access design also makes incidents easier to read. When something fails or behaves strangely, the first question is the caller.

## Read the Caller During Incidents
<!-- section-summary: During access failures and investigations, the active caller should be identified before policies are changed. -->

Access problems often look like missing permissions, but the first useful question is simpler: **which identity made the request?** A developer may think they are using the development account while their terminal is still pointed at production read-only. An ECS service may look like it has the right policy while the code is actually using an old static key from an environment variable.

For a local terminal, `aws sts get-caller-identity` shows who the next AWS command will act as:

```bash
aws sts get-caller-identity --profile image-prod-readonly
```

The account number, role name, and session name all matter. If the account is wrong, the profile or sign-in session is wrong. If the role is wrong, the Identity Center assignment or assume-role configuration produced a different session than the engineer expected.

For an application, the same idea moves through runtime configuration and CloudTrail. A Lambda function should show activity from its execution role. An ECS task should show the task role when application code calls S3 or DynamoDB. A GitHub Actions deploy should show an assumed role session created through web identity federation.

This habit prevents a common failure loop. Teams sometimes add permissions to the role they expected to use, rerun the workload, and still get `AccessDenied` because the real caller was different. Identifying the caller first points the fix at the smallest policy that actually applies to the request.

Now the full access story can be arranged by caller.

## Putting It All Together
<!-- section-summary: The finished access model gives humans, workloads, external systems, and emergency paths their own temporary access flows. -->

Return to the image-sharing application. The first version had one static key copied everywhere. The finished model has more pieces, but each piece matches a real caller and a real job.

```mermaid
flowchart TB
    People["People"]
    Source["Identity source"]
    Center["IAM Identity Center"]
    Cli["CLI profiles"]
    Apps["Applications"]
    Runtime["AWS runtime"]
    External["External workflows"]
    Proof["OIDC or certificate"]
    Roles["IAM roles"]
    STS["STS temporary credentials"]
    AWS["AWS requests"]
    Emergency["Emergency access"]

    People --> Source
    Source --> Center
    Center --> Cli
    Center --> STS
    Cli --> STS
    Apps --> Runtime
    Runtime --> Roles
    External --> Proof
    Proof --> Roles
    Roles --> STS
    STS --> AWS
    Emergency --> AWS
```

Engineers sign in through the workforce identity source. Groups and permission sets decide which accounts and jobs they can choose. CLI profiles use Identity Center sessions, so laptops do not need permanent AWS access keys for daily work.

The thumbnail function receives a Lambda execution role. The container service receives an ECS task role. EC2 workloads use instance profiles. EKS workloads use pod-level identity patterns. SDKs discover temporary credentials through standard provider chains, so application code can avoid storing AWS secrets.

The GitHub deployment workflow proves its repository and branch through OIDC before STS issues a role session. Outside servers can use federation or Roles Anywhere when they need temporary AWS access beyond AWS runtimes.

Emergency access stays small and monitored. Root is locked away. Long-term IAM user keys remain only for narrow legacy exceptions with owners, rotation, monitoring, and review dates.

The access model now matches the caller. People receive workforce sessions. Applications receive runtime roles. Pipelines receive federated sessions. Emergency users stay outside daily work. The copied key disappears, and with it the incident question nobody wants to ask: where else did that secret end up?

![Summary map showing people, CLI users, applications, pipelines, and emergency access flowing into STS temporary credentials before AWS services](/content-assets/articles/article-cloud-providers-aws-identity-security-human-access/access-path-summary.png)

*Use the summary as the quick access map: people use Identity Center, laptops use SSO profiles, applications use runtime roles, pipelines use OIDC roles, and emergency access remains separate and monitored.*

## What's Next

People and software can now receive AWS access without permanent keys. The next question is what AWS does with each signed request after those credentials are presented.

The next article follows one request through IAM policy evaluation. Then it uses that request flow to design least-privilege policies without guessing.

---

**References**

- [What is IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html) - Describes centralized workforce access, permission assignments, and temporary AWS account sessions.
- [Manage your identity source](https://docs.aws.amazon.com/singlesignon/latest/userguide/manage-your-identity-source.html) - Explains Identity Center identity sources, external identity providers, Active Directory options, and the built-in directory.
- [Manage AWS accounts with permission sets](https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetsconcept.html) - Explains permission sets, generated IAM roles, policy attachments, and account access behavior.
- [Assign user or group access to AWS accounts](https://docs.aws.amazon.com/singlesignon/latest/userguide/assignusers.html) - Documents group-based access assignment, permission set selection, and account assignment workflow.
- [Configuring IAM Identity Center authentication with the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html) - Shows SSO profile configuration, `aws sso login`, credential caching, and profile-based CLI use.
- [Set session duration for AWS accounts](https://docs.aws.amazon.com/singlesignon/latest/userguide/howtosessionduration.html) - Documents permission set session duration defaults, minimums, maximums, and console or CLI impact.
- [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html) - Defines IAM roles, trust policies, permission policies, temporary role sessions, and common role assumption patterns.
- [Temporary security credentials in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html) - Explains STS temporary credentials, expiration, and federation use cases.
- [Request temporary security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_request.html) - Documents STS operations, OIDC web identity role assumption, and temporary credential fields.
- [AWS SDKs and Tools standardized credential providers](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html) - Describes credential provider chains, automatic refresh, container credentials, web identity credentials, process credentials, and IMDS credentials.
- [IAM roles for Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html) - Documents instance profiles and EC2 role credential delivery through instance metadata.
- [Defining Lambda function permissions with an execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html) - Explains Lambda execution roles, service trust, and least-privilege guidance for functions.
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) - Documents ECS task roles, container credential delivery, CloudTrail task context, and isolation caveats.
- [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html) - Explains the startup role used by ECS and Fargate agents.
- [Learn how EKS Pod Identity grants pods access to AWS services](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html) - Documents service-account role associations, credential isolation, and SDK credential delivery for EKS workloads.
- [Create a role for OpenID Connect federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html) - Provides trust policy guidance and condition examples for OIDC roles.
- [What is IAM Roles Anywhere](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/introduction.html) - Explains trust anchors, certificates, profiles, and temporary credentials for non-AWS workloads.
