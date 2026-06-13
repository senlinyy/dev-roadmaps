---
title: "Authentication & Credentials"
description: "Learn how to safely authenticate Terraform with your cloud provider without exposing secrets in your code."
overview: "Providers need access to cloud APIs to provision infrastructure. We explore how to securely pass credentials to Terraform, the dangers of hardcoding secrets, and the best practices for local and CI/CD environments."
tags: ["terraform", "authentication", "security", "iam"]
order: 4
id: article-iac-terraform-foundations-authentication
---

## Table of Contents

1. [The Identity Dilemma in Automated Provisioning](#the-identity-dilemma-in-automated-provisioning)
2. [Early Authentication Pattern](#early-authentication-pattern)
3. [Azure Authentication Paths](#azure-authentication-paths)
4. [The Credential Precedence Chain](#the-credential-precedence-chain)
5. [Role Assumption and Multi-Tenant Isolation](#role-assumption-and-multi-tenant-isolation)
6. [Link-Local Hypervisor Handshakes: IMDSv2](#link-local-hypervisor-handshakes-imdsv2)
7. [OpenID Connect and Federated Pipeline Identity](#openid-connect-and-federated-pipeline-identity)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Identity Dilemma in Automated Provisioning

Terraform authentication is the credential path a provider plugin uses to prove it is allowed to read or change an external API.

Authentication in infrastructure provisioning is the secure process of proving a software system's identity to a cloud provider's API so that the system can safely create, modify, or destroy digital resources on your behalf. Just as an engineer uses a password and a multi-factor authentication token to log into a management console, an automation engine like Terraform needs a valid set of cryptographic credentials to execute API requests. Without a secure, verified identity, the cloud provider will reject any attempt to modify infrastructure, protecting your resources from unauthorized access.

To understand the operational challenges of managing these identities, consider an automated application deployment pipeline that manages a multi-tenant platform. In this architecture, a central deployment runner is responsible for provisioning and updating application resources across distinct, isolated cloud accounts allocated to different business divisions, such as payment gateways, analytics databases, and public web portals. Each division operates in a dedicated cloud account boundary to ensure that an incident in one business unit cannot compromise or disrupt another.

Operating in a multi-tenant environment introduces a critical security challenge. The central pipeline runner must be granted the authority to create resources in multiple separate accounts, yet storing static, long-lived access keys for each tenant inside the runner's environment is highly dangerous. If an attacker compromises the runner or gains access to its configuration, they can steal these static credentials and gain unrestricted access to every tenant's environment. To prevent such a catastrophic breach, platform engineers must design an authentication flow that relies on temporary, short-lived permissions that are dynamically generated and strictly limited in scope.

Under the hood, Terraform coordinates this authentication process using a decoupled provider architecture. When you execute an infrastructure command, the Terraform core binary parses your declarative configuration files, builds a directed acyclic graph of your resources, and initializes the required provider binaries. The core binary and the provider plugins run as separate operating system processes and communicate over a local plugin protocol. That local plugin handshake is separate from cloud authentication. The provider plugin is tasked with translating your high-level HCL resource blocks into cloud API calls, which means the provider process must locate, validate, and sign or authorize API requests using cloud credentials before transmitting them across the public network.

![Terraform Core talks to the AWS provider locally, then the provider resolves credentials and signs regional AWS API calls.](/content-assets/articles/article-iac-terraform-foundations-authentication/core-provider-auth-flow.png)

*The local plugin handshake is separate from cloud authentication; the provider still has to resolve credentials before it can call AWS.*

## Early Authentication Pattern

A safe provider configuration points Terraform at an identity source without storing the secret itself in code. The file can say which role to use, but the actual credential should come from a local profile, a managed identity, or a CI identity exchange. Example: the provider can use a `pipeline-deployer` profile to request temporary access to `MultiTenantPipelineExecutionRole` instead of committing an access key.

The following declarative configuration block outlines a secure, multi-tenant deployment provider setup. This block contains no long-lived secrets, passwords, or access keys. By delegating authentication to an external local profile that assumes a target IAM role, the configuration remains safe to commit to version control.

```hcl
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region  = "us-east-1"
  profile = "pipeline-deployer"

  assume_role {
    role_arn     = "arn:aws:iam::112233445566:role/MultiTenantPipelineExecutionRole"
    session_name = "TerraformMultiTenantDeployment"
  }
}
```

The configuration is structured to separate the declaration of the target infrastructure from the active credentials used to build it. The provider block references a local credentials profile named pipeline-deployer, which must exist in the environment where the execution occurs. `terraform init` installs the provider and initializes the backend; it does not prove that this AWS role can create every resource. The AWS provider resolves the profile and assumes the role when Terraform needs to validate, plan, refresh, or apply provider-backed objects. This approach ensures that individual engineers and automated pipelines can use the same Terraform configuration files while using different underlying identities, matching their specific access levels.

During the execution phase, the Terraform compiler parses this provider block to construct the target node in the dependency graph. Unlike standard resource nodes which can be processed in parallel, the provider node represents a foundational dependency that must be fully initialized and authenticated before any downstream resource nodes can begin evaluation. If the provider cannot resolve its initial credentials profile, or if the role assumption fails during the initial connection handshake, the compiler immediately halts the deployment DAG, preventing any partial or orphaned infrastructure allocations.

## Azure Authentication Paths

The exact credential chain is provider-specific. On Azure, the common Terraform paths are Azure CLI login for local development, service principals for automation, managed identity for Terraform running on Azure-hosted compute, and OpenID Connect for CI/CD systems such as GitHub Actions.

For local development, the beginner-friendly workflow is usually:

```bash
az login
az account set --subscription "<subscription-id>"
terraform plan
```

The AzureRM provider can use the active Azure CLI account, so no client secret has to be written into the Terraform configuration. For automation, do not build new pipelines around a human Azure CLI login. Microsoft now requires stronger interactive authentication for user identities and recommends workload identities for scripts and automation. Service principals, managed identity, and OIDC federation keep Terraform tied to a workload identity instead of a person's login session. The security idea is the same as the AWS examples in this article: avoid hardcoded long-lived secrets, give Terraform the smallest role it needs, and prefer short-lived or platform-managed identity whenever the runner supports it.

| Environment | Common Azure credential pattern |
| --- | --- |
| Engineer laptop | Azure CLI login |
| GitHub Actions | OIDC federation to Microsoft Entra ID |
| Azure VM, VMSS, or container host | Managed identity |
| Legacy or simple automation | Service principal credentials from a secret store |

## The Credential Precedence Chain

A credential precedence chain is the ordered list of places a provider checks for credentials. The provider stops at the first complete credential source it can use. Example: if `AWS_ACCESS_KEY_ID` is set in your shell, the AWS provider uses that environment variable before it checks `~/.aws/credentials`.

When the AWS provider binary initializes, it executes a pre-defined search algorithm to resolve the credentials it will use to sign API requests. This process is known as the provider credential resolution chain, and it lets the provider discover valid authentication data in a wide variety of running environments. Understanding this resolution sequence is vital because developers often run Terraform from local laptops, whereas automated runners execute the same code from containerized cloud environments or virtual machines.

![Terraform authentication follows a credential precedence chain before choosing the identity used for provider calls.](/content-assets/articles/article-iac-terraform-foundations-authentication/credential-precedence-chain.png)

*Authentication bugs often come from Terraform using a different credential source than the one the operator expected.*

The provider scans a series of potential credential sources in a strict hierarchical order. The search stops the moment the provider locates a valid, complete set of credentials. If a higher-priority source contains incomplete or malformed configuration data, the provider does not fall back to lower-priority sources; instead, it halts execution and returns an authentication error.

The resolution sequence progresses from the most explicit, local configurations to the most implicit, environment-based credentials. First, the provider checks the parameters declared inside the HCL provider block itself. While attributes like access_key and secret_key can be defined directly in code, doing so is highly discouraged because they can be exposed through configuration history, plan files, logs, and state depending on how the provider uses them.

Second, the provider scans the active operating system environment variables. The environment represents the memory space of the active shell process, and the operating system automatically copies these variables to any child processes spawned by the shell, including the provider plugin. Because these variables reside in process memory, they are highly ephemeral and are automatically destroyed when the shell session terminates.

Third, if no environment variables are present, the provider reads the local filesystem to locate shared AWS configuration and credentials files. These files are typically stored in the user's home directory under a hidden directory. The provider uses an internal parser to read the INI-style structure of these files, matching the profile specified in the configuration or defaulting to the primary profile.

Fourth, if no filesystem credentials exist, the provider queries the hosting environment's container metadata or instance metadata services. This step allows Terraform to run securely inside cloud infrastructure without any static credentials whatsoever.

To clarify how the provider evaluates these competing sources, the following table outlines the exact precedence hierarchy, the file or variable names, and the relative security rating of each layer:

| Precedence | Source Name | Primary Identifier | Typical Lifecycle | Security Grade |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Inline Provider Block | access_key and secret_key | Infinite (Static) | Low |
| 2 | System Environment | AWS_ACCESS_KEY_ID | Ephemeral (Shell Session) | Medium |
| 3 | Shared Credentials File | ~/.aws/credentials | Long-lived (Static file) | Medium |
| 4 | Shared Configuration File | ~/.aws/config | Long-lived (Static file) | Medium |
| 5 | Container Metadata | AWS_CONTAINER_CREDENTIALS_RELATIVE_URI | Ephemeral (Dynamic) | Highest |
| 6 | Instance Metadata Service | http://169.254.169.254 | Ephemeral (Dynamic) | Highest |

A common operational point of confusion is the interaction between environment variables and local credentials files. If a developer has configured a default profile in their credentials file, but also has active environment variables exported in their terminal session, the provider will always select the environment variables. This is because the operating system environment block occupies a higher priority tier in the resolution chain. This behavior allows developers to quickly override their local file-based credentials for a single run by exporting environment variables, without needing to modify their saved configuration profiles.

## Role Assumption and Multi-Tenant Isolation

Role assumption means one trusted identity asks for a short-lived session as another role. It is useful when a central Terraform runner must deploy into separate accounts without storing permanent keys for each account. Example: a GitHub Actions runner can authenticate once, assume `arn:aws:iam::112233445566:role/MultiTenantPipelineExecutionRole`, and receive temporary keys that expire after the run.

For a multi-tenant deployment pipeline, relying on static, long-lived access keys is a significant security liability. If a single set of access keys is leaked, the target account is exposed until an administrator manually revokes the keys in the cloud console. To mitigate this risk, modern enterprise architectures enforce role-based access control using the Security Token Service. Instead of authenticating directly with permanent keys, the deployment pipeline uses an initial identity to temporarily assume an IAM role created within the target tenant's cloud account.

The role assumption mechanism operates through the STS AssumeRole API protocol. When the Terraform provider processes an assume_role configuration block or receives an instruction to assume a role via a local profile, it initiates an outbound HTTPS request to the regional or global STS endpoint. The request identifies the target role Amazon Resource Name, a user-defined session name, and optionally an external ID used to protect third-party cross-account access.

Upon receiving the request, the AWS Security Token Service evaluates the relationship between the caller's identity and the target role. The target role must contain a trust relationship policy that explicitly permits the caller's IAM identity to invoke the AssumeRole action. If the trust relationship is validated and the caller's permissions allow it, STS generates a set of temporary, short-lived security credentials.

This dynamic response payload contains three critical components: a temporary access key identifier, a temporary secret access key, and a session token. Treat the session token as an opaque credential string. AWS documents the expiration as a separate response field, and callers should rely on that field rather than trying to interpret the token contents. The lifetime of these temporary credentials can be configured within role and API limits, and the common default is one hour.

The provider captures this JSON payload in memory, extracts the temporary keys, and uses them to sign all subsequent API requests. Every HTTP request sent by the provider to create or modify resources is signed using the AWS Signature Version 4 HMAC algorithm. This signature incorporates the temporary access key and session token. Because the temporary credentials automatically expire, any intercepted or leaked keys become completely useless once the session duration passes, drastically reducing the window of vulnerability.

To ensure strict accountability, the provider passes the session_name parameter during the STS handshake. AWS logs this session name directly into CloudTrail, which is the regional auditing plane for cloud actions. If an infrastructure change is made, security administrators can correlate the API call directly to the specific execution run of the central pipeline, ensuring that every deployment action is fully auditable.

![AWS STS validates a role trust policy, returns temporary session keys, and the Terraform provider uses them for signed API calls.](/content-assets/articles/article-iac-terraform-foundations-authentication/sts-assume-role-flow.png)

*Role assumption gives Terraform short-lived credentials for the target account instead of permanent access keys.*

## Link-Local Hypervisor Handshakes: IMDSv2

IMDSv2 is AWS's instance metadata service for giving an EC2 instance short-lived credentials for its attached IAM role. A link-local address is an IP address that only works from the local machine or local network path, not from the public internet. Example: Terraform running on an EC2 runner can request credentials from `169.254.169.254` instead of reading an access key file.

When running Terraform pipelines from an EC2 virtual machine, there is no need to distribute or store credentials files if the instance has an IAM role attached. Instead, the provider can use the host metadata path to obtain temporary, role-based credentials on demand. This EC2 exchange is performed through the Instance Metadata Service, which resides at the standardized link-local IP address `169.254.169.254`. ECS task roles use a related but separate container credential mechanism exposed through container-specific environment variables and metadata endpoints, so avoid describing every AWS compute credential path as IMDS.

The address 169.254.169.254 is a non-routable IP address reserved for local network interfaces. When the provider process initiates a request to this address, the packet does not travel across the physical data center network. Instead, the host hypervisor's virtual switch intercepts the packet at the hypervisor layer, recognizing that it originated from a local guest virtual machine. The hypervisor handles the request internally, ensuring that virtual machines cannot spy on or manipulate the metadata queries of adjacent instances sharing the same physical hardware.

To protect against modern application-level security threats, such as Server-Side Request Forgery vulnerabilities, EC2 instances can be configured to require the second version of this metadata service (IMDSv2). IMDSv2 replaces the older, stateless request-response model with a session-oriented handshake protocol. The client must first acquire a metadata token before the metadata service will release role credentials.

The IMDSv2 session handshake is executed in a precise sequence of HTTP transactions:

**IMDSv2 HTTP Transaction Flow**

| Step | HTTP Method | Target Path | Required Headers | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| 1 | PUT | /latest/api/token | X-aws-ec2-metadata-token-ttl-seconds: 21600 | A plaintext session token string |
| 2 | GET | /latest/meta-data/iam/security-credentials/ | X-aws-ec2-metadata-token: [token_value] | The name of the IAM role attached to the host |
| 3 | GET | /latest/meta-data/iam/security-credentials/[role] | X-aws-ec2-metadata-token: [token_value] | JSON object containing temporary credentials |

The initial PUT request requires the client to define the lifetime of the metadata token using the TTL header, which can range from one second to six hours. Crucially, the hypervisor's virtual switch sets the IP Time-To-Live header of the response packet to 1. This prevents the token from traversing any network hops, ensuring that if an attacker attempts to exploit an open reverse proxy or a web-facing firewall to fetch the token, the packet is discarded by the first network hop, neutralizing the SSRF attack vector.

Once the provider obtains the plaintext token from the PUT response, it caches the token in its process memory. It then initiates a GET request to the role credentials path, attaching the token in the metadata token header. The metadata service responds with a JSON payload containing the temporary IAM access credentials. The provider automatically parses this JSON structure, extracts the access key, secret key, and session token, and uses them to sign AWS API calls to the cloud provider's regional APIs.

Under the hood, the security of this exchange relies on hypervisor-level network verification. When the guest operating system transmits packets to the link-local destination, the hypervisor tracks the source virtual network interface card (vNIC) and maps it directly to the virtual machine's UUID. The metadata service backend uses this UUID lookup to verify that the guest is authorized to access the specific IAM role associated with the instance. If a guest attempts to spoof its source address or request a role allocated to another machine, the vSwitch immediately drops the packet.

## OpenID Connect and Federated Pipeline Identity

OpenID Connect, or OIDC, lets a CI/CD job prove its identity to a cloud provider with a signed token instead of a stored cloud access key. The cloud provider checks claims in that token, such as repository, branch, and workflow, and returns temporary credentials when they match the trust policy. Example: a workflow on the `main` branch can exchange its GitHub-issued token for an AWS role session before running `terraform apply`.

For automated deployment pipelines running on external platforms, such as GitHub Actions, GitLab CI, or local Jenkins clusters, there are no cloud metadata services to query. Historically, teams solved this by creating dedicated IAM users, generating static, long-lived access keys, and saving them as encrypted repository secrets. This approach created significant management overhead, as these keys required manual rotation and were vulnerable to credential theft if a developer accidentally printed environment variables to build logs.

![A CI job can exchange an OIDC token for a short-lived credential before running Terraform.](/content-assets/articles/article-iac-terraform-foundations-authentication/federated-pipeline-token-flow.png)

*Pipelines should trade signed identity proof for temporary credentials instead of storing long-lived keys.*

Modern secure systems eliminate static keys entirely by implementing OpenID Connect (OIDC) identity federation. Identity federation allows your cloud provider to trust the identity claims asserted by your external CI/CD platform. Instead of verifying a secret password, the cloud provider verifies a cryptographically signed identity token issued by the CI/CD platform's authentication server, exchanging it for temporary, role-based credentials.

Under the hood, this federated exchange follows a highly coordinated cryptographic loop. When a pipeline job begins, the CI/CD runner requests an identity token from its local authentication agent. The agent generates a JSON Web Token (JWT) signed with the CI/CD provider's private key. This JWT contains structured claims that identify the running job, including the organization name, repository name, branch, and workflow execution ID.

The pipeline runner then launches the Terraform execution flow. Before starting the provider, the runner initiates an STS AssumeRoleWithWebIdentity API call. The request transmits the CI/CD platform's JWT and the target IAM role's ARN to the AWS Security Token Service. AWS STS extracts the issuer claim from the JWT and contacts the CI/CD platform's public OIDC discovery endpoint to retrieve the public cryptographic keys used to sign the token.

Once the signature is verified, AWS STS evaluates the trust relationship policy attached to the target IAM role. This policy defines strict conditions that must match the claims embedded within the JWT. For example, the trust policy can restrict role assumption so that it is only permitted if the repository matches your production repository and the branch matches main. If all conditions are met, AWS STS returns temporary AWS access credentials to the runner, which are immediately injected into the process environment for Terraform to use.

![A CI runner can exchange signed OIDC claims for temporary cloud credentials, then run Terraform against target accounts.](/content-assets/articles/article-iac-terraform-foundations-authentication/oidc-pipeline-trust-flow.png)

*OIDC federation lets the cloud provider trust a specific repository, branch, and workflow without storing a long-lived cloud key in CI.*

This federated architecture ensures that the pipeline runner never possesses long-lived secrets. Every credential used during the run is ephemeral and bound to the specific execution context of the pipeline job. If a runner is compromised mid-execution, the stolen session keys will automatically expire shortly after the job finishes, and because there are no static credentials saved in the repository settings, there are no keys to rotate or revoke.

To fully understand this cryptographic loop, the following outline describes the exact system-level sequence:

- **JWT Issuance**: The CI platform issues a JWT signed using RS256, which contains a payload defining the runner's metadata, including issuer, audience, and subject.
- **OIDC Discovery**: AWS STS calls the public discovery endpoint of the CI platform to retrieve the JSON Web Key Set (JWKS), verifying the signature of the incoming JWT.
- **Claim Match Evaluation**: AWS STS reads the trust policy conditions to verify that the repository claim matches the target configuration.
- **Session Dispatch**: STS issues temporary session keys directly to the pipeline runner process memory, which are then used by the AWS provider plugin to authenticate downstream requests.

## Putting It All Together

Secure Terraform authentication is about giving the provider a short-lived identity for the current run, not leaving permanent credentials in configuration files. Local developers can use CLI logins or profiles, cloud-hosted runners can use metadata or managed identity, and external CI/CD systems can use OIDC federation. Example: the same Terraform code can run from a laptop with an AWS profile and from GitHub Actions with OIDC, while both end up assuming the same deployment role.

Managing Terraform authentication securely in a multi-tenant environment requires moving away from static, long-lived access keys and embracing temporary, context-bound identities. By combining the AWS provider's internal credential precedence chain with modern authentication workflows, platform teams can reduce the risk of accidental credential leaks.

* **Automated Multi-Tenant Pipelines**: Leverage OIDC federation to dynamically acquire initial AWS session keys, removing long-lived secrets from version control and repository configurations.
* **Role Delegation via STS**: Use cross-account IAM roles to isolate tenant environments, allowing a single pipeline identity to safely pivot and deploy to distinct target accounts using temporary session tokens.
* **Hierarchical Credential Discovery**: Rely on the provider's precedence chain to ensure that environment variables, local filesystem configuration profiles, and metadata endpoints are resolved consistently across local and CI/CD environments.
* **Link-Local IMDSv2 Loops**: Secure in-cloud execution environments by utilizing the session-oriented IMDSv2 PUT-GET token handshake, protecting temporary instance role credentials from SSRF exploits.
* **Azure Managed Identity and OIDC**: For Azure, prefer Azure CLI login locally, managed identity on Azure-hosted runners, and GitHub OIDC federation for external CI/CD, following Microsoft Entra ID guidance.

By establishing these automated, secret-free authentication boundaries, platform teams guarantee that infrastructure modifications are cryptographically authorized, audit logs in CloudTrail record unique session names for every pipeline execution, and the overall system remains resilient against credential theft and cross-tenant privilege escalation.

## What's Next

Now that we have established how Terraform securely authenticates and assumes the identities required to modify infrastructure, our next challenge is managing the state files generated by these operations. As Terraform provisions or modifies resources, it records the physical properties, IDs, and dependencies of those resources in a state file. In a multi-tenant environment, this state file contains highly sensitive details, including resource configurations and generated database passwords.

In the next article, we will examine the mechanics of remote state storage backends. We will explore how to configure encrypted state storage buckets, how to implement state locking protocols to prevent simultaneous pipeline executions from corrupting the state, and how to design state access policies that respect the isolation boundaries of our multi-tenant accounts.

![A six-part summary infographic for Terraform authentication covering credential source, precedence, role assumption, OIDC, short-lived token, and audit trail.](/content-assets/articles/article-iac-terraform-foundations-authentication/auth-summary.png)

*Use this summary as the quick checklist for safer Terraform credentials in local and pipeline runs.*


---

**References**

- [AWS Provider Authentication Options](https://registry.terraform.io/providers/hashicorp/aws/latest/docs#authentication-and-configuration) - Details the standard resolution order and supported credentials methods for the AWS provider.
- [AssumeRole API Reference](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html) - Explains the request parameters, response elements, and security mechanisms of AWS STS role assumption.
- [Instance Metadata Service Version 2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html) - Details the PUT-GET token handshake protocol and security features of IMDSv2.
- [OpenID Connect in GitHub Actions](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - Guides the setup of OIDC trust federation and temporary credential exchange for CI/CD runners.
- [AssumeRoleWithWebIdentity API Reference](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html) - Focuses on federating external identities and JWT token verification in AWS STS.
- [Amazon ECS Task IAM Roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) - Official distinction between task credentials and EC2 instance metadata credentials.
- [Authenticate Terraform to Azure (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/authenticate/authenticate-to-azure) - Overview of supported Azure authentication approaches for Terraform.
- [Authenticate Azure CLI (Microsoft Learn)](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli) - Microsoft guidance on Azure CLI authentication and workload identity recommendations for automation.
- [Authenticate with a Service Principal (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/authenticate-to-azure-with-service-principle) - Microsoft guidance for service principal based automation.
- [Authenticate with Managed Identity (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/authenticate/authenticate-to-azure-with-managed-identity-for-azure-services) - Microsoft guidance for Azure-hosted Terraform runs using managed identity.
- [Connect from GitHub Actions to Azure with OpenID Connect (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect) - Microsoft guidance for secretless GitHub Actions authentication to Azure.
