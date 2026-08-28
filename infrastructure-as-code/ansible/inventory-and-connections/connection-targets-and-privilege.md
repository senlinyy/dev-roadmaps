---
title: "Connections and Privilege Escalation"
description: "Understand how Ansible chooses the host address, login user, and privilege escalation user."
overview: "Ansible connection failures are easier to read when address, login, and privilege are separate ideas."
tags: ["ansible", "ssh", "become", "privilege"]
order: 3
id: article-infrastructure-as-code-ansible-connection-targets-privilege
---

## Table of Contents

1. [Which Decisions Happen Before a Task Runs?](#which-decisions-happen-before-a-task-runs)
2. [How Does Ansible Choose the Target and Login User?](#how-does-ansible-choose-the-target-and-login-user)
3. [How Do SSH Keys and Controller Credentials Differ?](#how-do-ssh-keys-and-controller-credentials-differ)
4. [How Does Privilege Escalation Work?](#how-does-privilege-escalation-work)
5. [How Do You Test Each Access Layer?](#how-do-you-test-each-access-layer)
6. [How Do You Change Sudo and SSH Safely?](#how-do-you-change-sudo-and-ssh-safely)
7. [How Do You Read and Roll Back Access Failures?](#how-do-you-read-and-roll-back-access-failures)
8. [What Is the Complete Access Model?](#what-is-the-complete-access-model)
9. [Check Your Answers](#check-your-answers)

Before Ansible can change a protected file on a Linux host, it has to make three decisions. It chooses **where to connect**, **which remote user logs in**, and **which user runs the task after privilege escalation**. These decisions often get mixed together, and that is why a simple failure can feel like several different problems at once.

![Connection Decision Stack](/content-assets/articles/article-infrastructure-as-code-ansible-connection-targets-privilege/connection-decision-stack.png)

*The decision stack separates the target host, connection address, login user, SSH key, elevated user, and final task.*

For the application platform, Ansible connects to `application-web-01` over SSH using a private address. It logs in as the `deploy` user because that account is managed by the image build and deployment process. When a task needs to write `/etc/application/application.yml` or restart `application-web.service`, Ansible escalates with `become` so the task can run with root privileges.

Keeping those layers separate gives you a practical debugging path. A private IP or DNS problem belongs to the connection target. A rejected SSH key belongs to the login user and credentials. A sudo prompt or permission denied error after the task starts belongs to privilege escalation.

Keep these questions in view as you work through the lesson:

1. **Which Decisions Happen Before a Task Runs?**
2. **How Does Ansible Choose the Target and Login User?**
3. **How Do SSH Keys and Controller Credentials Differ?**
4. **How Does Privilege Escalation Work?**
5. **How Do You Test Each Access Layer?**
6. **How Do You Change Sudo and SSH Safely?**
7. **How Do You Read and Roll Back Access Failures?**
8. **What Is the Complete Access Model?**

## Which Decisions Happen Before a Task Runs?
<!-- section-summary: Ansible connection behavior is easier to debug when target, login user, and privilege user stay separate. -->

Here is the production shape in one place:

```yaml
application-web-01:
  ansible_host: 10.42.10.11
  ansible_user: deploy
  ansible_port: 22
  ansible_ssh_private_key_file: ~/.ssh/application-prod-deploy
  ansible_become: true
  ansible_become_method: sudo
  ansible_become_user: root
```

Local CLI runs may use the key path directly. Controller jobs usually store the SSH key and become password in a credential object, then inventory keeps only the host, user, and privilege intent. That split keeps secrets out of content while keeping the access model visible during review.

The three decisions form independent boundaries:

```text
connection target  → where and by which transport?
login identity     → who authenticates to that target?
execution identity → who is allowed to perform this task?
```

A successful decision does not prove the next one. Reaching TCP port 22 does not prove authentication. Logging in as `deploy` does not prove sudo permission. Becoming root does not prove the application command is correct. Debugging should move through the boundaries in order.

Authentication and authorization answer different questions. Authentication proves an identity—usually by showing that the controller possesses an SSH private key accepted for `deploy`. Authorization determines what that authenticated identity may do. Unix file permissions, sudoers rules, service ownership, and the requested `become_user` still constrain the task after login succeeds.

Ansible may involve four identities in one workflow:

1. The local person or CI identity launching the run.
2. The operating-system user running Ansible on the controller.
3. The remote login user that starts the session.
4. The privilege user that executes a selected task.

They can all be different. Running Ansible as root on the controller does not make the remote task root. Conversely, an unprivileged CI runner can hold an approved machine credential that logs in remotely and uses a controlled sudo path. Local filesystem privilege and remote authorization are unrelated systems.

For an SSH-based module, the conceptual execution path is:

```text
controller prepares module payload
        ↓
SSH authenticates the login user
        ↓
payload reaches a remote temporary location
        ↓
become optionally changes the execution identity
        ↓
remote Python or another runtime executes the module
        ↓
structured result returns to the controller
```

This explains why the login user needs temporary-file and runtime access even when every important task later becomes root. It also explains why narrowly whitelisting visible shell commands in sudoers can break modules that execute transferred payloads.

## How Does Ansible Choose the Target and Login User?
<!-- section-summary: The connection target tells Ansible the address, port, and transport for a managed node. -->

The **connection target** is the address and transport Ansible uses to reach a host. For Linux fleets, that usually means SSH to a private IP address or private DNS name. The inventory name can stay stable, while `ansible_host` points to the current reachable address.

```yaml
prod_web:
  hosts:
    application-web-01:
      ansible_host: 10.42.10.11
      ansible_port: 22
    application-web-02:
      ansible_host: 10.42.10.12
      ansible_port: 22
```

This is useful during replacements. If `application-web-01` is rebuilt and receives a new private IP, the team updates `ansible_host` or lets dynamic inventory produce the new value. Play output, host variables, and runbooks can still use the stable inventory name.

Connection settings can come from inventory variables, Ansible configuration, command-line options, and environment variables. When the behavior surprises you, inspect the compiled host first because it shows what Ansible loaded for that host.

```bash
ansible-inventory -i inventories/prod --host application-web-01
```

If the host output shows the wrong address or port, fix inventory before reading playbook tasks. The task file has no chance to work when the transport points at the wrong machine.

An address alone is not a connection plan. Ansible also needs a connection plugin, port, login identity, authentication material, and sometimes an interpreter. Common inventory values include:

```yaml
application-web-01:
  ansible_host: 10.42.10.11
  ansible_connection: ssh
  ansible_port: 22
  ansible_user: deploy
  ansible_python_interpreter: /usr/bin/python3
```

These values should describe how the target really works. Do not set an interpreter path or SSH option everywhere merely because one legacy host once needed it. Broad connection defaults can break newer images and conceal which systems differ.

SSH is the common Linux path, but it is not Ansible's only connection plugin. Network devices, Windows systems, containers, local execution, and API-backed targets can use different transports. The same separation still applies: inventory identifies the target and selects the plugin; that plugin defines how execution reaches the managed system.

`remote_user` is a playbook keyword, while `ansible_user` is a connection variable. They can express similar intent at different precedence levels. Connection variables generally have strong precedence, so an inventory `ansible_user: automation` can surprise someone who expects `remote_user: deploy` or `-u deploy` to win. Inspect the effective host variables when the login identity is unexpected.

### Which account starts the remote session?
<!-- section-summary: The login user authenticates to the remote host before become changes task privileges. -->

The **login user** is the account Ansible uses to start the remote session. For SSH, this might be `deploy`, `ubuntu`, `ec2-user`, `ansible`, or another account your image pipeline creates. In inventory, this is usually `ansible_user`.

```yaml
prod_web:
  vars:
    ansible_user: deploy
  hosts:
    application-web-01:
      ansible_host: 10.42.10.11
    application-web-02:
      ansible_host: 10.42.10.12
```

The login user needs enough access to authenticate, create Ansible's temporary files, run Python modules, and read basic system facts. The application user and the root user can stay separate from this login account. Many teams use a locked-down deployment account with SSH keys, then use `become` only for tasks that need elevated permissions.

This distinction matters during offboarding and incident response. If the `deploy` private key is rotated, SSH access changes. If the sudo policy changes, privileged task execution changes. Treating those as separate controls makes audits and break-fix work much cleaner.

Dedicated automation accounts are common because they make access reviewable and revocable. A team can rotate one machine credential, constrain its source network, audit its sudo activity, and remove it without tying automation to an employee account. The account should still have only the access the automation path needs.

The bootstrap problem needs an explicit plan. A new host cannot use the final automation account until something creates that account, installs its authorized key, and grants the required policy. Image building, cloud-init, provisioning scripts, or a tightly controlled first-run credential can establish the initial path. Do not assume Ansible can bootstrap itself through an account that does not yet exist.

Connection passwords and become passwords are different credentials. One authenticates the remote login; the other authorizes escalation after login. Passwordless sudo does not mean passwordless SSH, and SSH key authentication says nothing about sudo. A controller credential can carry both, but operators should still diagnose them as different stages.

Connection settings should describe reality, while the credentials themselves remain controller-side. Shared inventory may say `ansible_user: deploy`; the automation platform decides which protected private key proves that identity. This keeps topology and access intent reviewable without placing secret material in the content repository.

## How Do SSH Keys and Controller Credentials Differ?
<!-- section-summary: SSH credentials prove who Ansible is, while host keys help prove which machine Ansible reached. -->

Ansible usually authenticates over SSH with a private key. In a local project, the key path might live in inventory for a lab, although production teams often prefer controller-managed credentials or CI secrets so shared inventory never carries private key paths.

```yaml
prod_web:
  vars:
    ansible_user: deploy
    ansible_ssh_private_key_file: ~/.ssh/application-prod-deploy
```

In Red Hat Ansible Automation Platform or AWX-style workflows, the inventory normally describes hosts and groups, while a machine credential supplies the SSH username, private key, and optional become password at job launch. That split keeps secrets out of content repositories and lets platform administrators control who can run which credential against which inventory.

Host key verification checks that the SSH server Ansible reached is the machine you expected. Production automation should manage known hosts intentionally so convenience never removes that protection. A common pipeline step is to populate a controlled `known_hosts` file from trusted provisioning output or a secure source of host fingerprints.

```bash
ssh-keyscan application-web-01.internal.example.com >> ./known_hosts
ANSIBLE_HOST_KEY_CHECKING=True ANSIBLE_SSH_ARGS="-o UserKnownHostsFile=./known_hosts" \
  ansible -i inventories/prod application-web-01 -m ansible.builtin.ping
```

That example shows the idea, and the trust source matters. `ssh-keyscan` alone reads what the network presents at that moment, so production teams should compare fingerprints against provisioning records, cloud instance data, configuration management records, or another trusted channel.

For production, a reviewed `known_hosts` file is safer than turning off host key checking. Some teams generate it from trusted infrastructure data during the pipeline, then store it as a short-lived CI workspace file. Others manage it as part of the bastion or controller setup. The runner should know which host key belongs to `10.42.10.11` before the playbook starts changing `/etc`.

Two SSH key concepts are easy to confuse. A **user key pair** authenticates the controller-side client to the server: the controller holds the private key and the remote account trusts the corresponding public key in `authorized_keys`. A **host key** authenticates the server to the client: the server holds its host private key and the controller records or verifies the public fingerprint.

These controls protect opposite directions:

```text
user key: controller proves “I may log in as deploy”
host key: server proves “I am the intended managed host”
```

Disabling host-key checking removes the second proof. The controller may still authenticate successfully while sending privileged automation to an impersonated or mistakenly addressed server. Host-key checking is therefore a security control, not an inconvenience to switch off when inventory changes.

Credential placement is part of the controller security boundary. Private keys, connection passwords, become passwords, Vault passwords, cloud tokens, and known-host trust material all exist before a remote task executes. Anyone who can alter a job's inventory, credential binding, or execution environment may be able to redirect or broaden automation. Protect controller configuration with the same seriousness as sudoers on managed hosts.

Local key paths such as `~/.ssh/...` are also context-dependent. The path expands on the machine and user running Ansible, not on the managed node. A path that works on one developer laptop may not exist in CI. Controller-managed credentials avoid this portability problem and let job authorization decide who may combine a credential with a production inventory.

Key rotation should preserve a proven access path. Install and verify the new public key before removing the old one, run a small Ansible command through the new credential, and only then retire the previous key. Replacing both sides in one unverified step can turn a routine rotation into an access outage.

## How Does Privilege Escalation Work?
<!-- section-summary: become runs selected tasks as another user after the SSH login succeeds. -->

**Privilege escalation** means Ansible logs in as one user and runs a task as another user. Ansible calls this `become`. On Linux, `become` usually uses sudo, although Ansible supports other escalation tools on different platforms.


![Privilege Escalation Boundary](/content-assets/articles/article-infrastructure-as-code-ansible-connection-targets-privilege/privilege-escalation-boundary.png)

*The privilege boundary shows the difference between logging in normally and crossing a controlled sudo boundary for root-level work.*

```yaml
- name: Configure application web servers
  hosts: prod_web
  tasks:
    - name: Render app config
      ansible.builtin.template:
        src: application.yml.j2
        dest: /etc/application/application.yml
        owner: root
        group: application
        mode: "0640"
      become: true

    - name: Check local health endpoint
      ansible.builtin.uri:
        url: http://127.0.0.1:9000/health
        return_content: false
```

In this play, the config task needs elevated filesystem access, so it uses `become: true`. The health check runs as the login user because it only calls a local HTTP endpoint. Keeping escalation close to the task makes the review clearer because readers can see exactly which work needs extra privilege.

`become_user` controls which user the task uses after privilege escalation. The default is usually root. A task might use `become_user: application` when it should run as the application account, such as a command that writes user-owned cache files or runs an application migration tool.

```yaml
- name: Run application database migration as the service account
  ansible.builtin.command: /opt/application/bin/application migrate
  become: true
  become_user: application
```

The login user still exists in this flow. Ansible connects as `deploy`, then escalates for that task. That explains many confusing failures: SSH can work while sudo fails, and sudo can work while a specific `become_user` lacks access to the target file or command.

It is called `become` rather than `sudo` because the abstraction is broader than one operating system or one escalation tool. `become: true` activates escalation, `become_user` selects the execution identity, and `become_method` selects the mechanism. On a Linux host the method is commonly `sudo`, but the conceptual model applies to other supported methods and platforms.

```yaml
- name: Perform protected system work
  ansible.builtin.package:
    name: application-api
    state: present
  become: true
  become_method: sudo
  become_user: root
```

The sudo policy is still enforced. Ansible does not bypass `/etc/sudoers`; it automates a request through the configured method. The login account needs permission to switch to the requested identity, and the controller must provide a password if the policy requires one.

Play-level `become: true` is convenient if nearly every task needs the same privilege. Task-level `become` makes a mixed play's privilege surface more visible. Choose the smallest scope that accurately describes the work. A health request, fact-free assertion, or controller-side API call should not acquire root merely because a neighboring package task needs it.

Least privilege does not always mean becoming root. A database migration may need the database service account; a cache generation task may need the application owner. `become_user` can select that unprivileged identity, although transitions between unprivileged accounts introduce temporary-file and permission subtleties. Test the exact module path and account combination rather than assuming every non-root transition behaves like sudo-to-root.

The full identity calculation is:

```text
controller execution identity
        ↓ holds or receives credential
remote login identity (`ansible_user`)
        ↓ optional become method
task execution identity (`become_user`)
```

Application file ownership forms another layer. A task may execute as root but deliberately create a file owned by the application account. The execution identity controls whether the operation is authorized; module arguments control the desired owner and group of the resulting resource.

Use escalation where Unix permissions require it, not as a universal remedy for unclear access. If a normal task fails because it writes an inappropriate location, changing the destination or ownership model may be better than broadening sudo. Root makes many operations possible, but it also increases the consequence of a wrong target or command.

Passwords need precise names in runbooks. A connection password answers the SSH or transport prompt. A become password answers the escalation prompt. `--ask-pass` and `--ask-become-pass` serve different boundaries. In controller jobs, machine credentials may provide both fields, yet a failure message still identifies which boundary rejected the operation.

## How Do You Test Each Access Layer?
<!-- section-summary: Small commands can prove the connection, login identity, and become behavior before a full playbook runs. -->

Test the path in layers. First, confirm Ansible can connect and run a small module as the login user. This checks inventory, SSH, key authentication, Python discovery, and basic module execution.

```bash
ansible -i inventories/prod prod_web -m ansible.builtin.ping
```

Then ask the host which user is running without escalation. This is a simple way to confirm `ansible_user` and credential selection.

```bash
ansible -i inventories/prod application-web-01 -m ansible.builtin.command -a whoami
```

After that, test escalation. The `-b` flag enables become for the ad hoc command.

```bash
ansible -i inventories/prod application-web-01 -b -m ansible.builtin.command -a whoami
```

A healthy path usually prints `deploy` for the second command and `root` for the third command. If the first command fails, fix connection and login. If the first two work and the third fails, focus on sudo policy, become configuration, become password handling, or the requested `become_user`.

For playbooks, use `--check` when supported and narrow to one host before the first production change. Check mode covers only modules and side effects that support it, and it still gives useful evidence before a real canary run.

```bash
ansible-playbook -i inventories/prod deploy-application-web.yml --limit application-web-01 --check --diff
```

Think of these checks as a dependency ladder:

```text
inventory resolution
  ↓
network and transport reachability
  ↓
remote authentication
  ↓
basic module execution
  ↓
privilege escalation
  ↓
application-specific protected work
```

Do not jump to the top while a lower layer is uncertain. A full deployment failure may contain package, template, handler, and health-check noise. The small commands isolate one boundary and give a faster, safer diagnosis.

Confirm the login identity explicitly with `whoami` because a successful `ping` does not display which account executed the module. Then add `-b` and repeat. If a non-root `become_user` matters, specify it in a small test that creates or reads an appropriate user-owned resource rather than assuming root success proves every transition.

Controller jobs should test the same inventory, credential binding, execution environment, bastion path, and known-hosts policy that the deployment uses. A successful laptop test proves the target is reachable from the laptop with that developer's key; it does not prove the automated controller path.

After access succeeds, test a representative protected operation in check mode or against a disposable/canary host. `whoami` proves identity, not that sudoers permits the transferred module pattern or that the target directory has the expected mount and security labels.

## How Do You Change Sudo and SSH Safely?
<!-- section-summary: Sudo policy changes deserve validation because a bad rule can lock automation out of privileged work. -->

The sudo policy is part of the automation contract. The `deploy` user may be able to log in, and privileged tasks still need a sudo rule that allows the required escalation. In many production Ansible environments, teams allow controlled automation users to run passwordless sudo through a protected credential path, then restrict who can launch that credential in the automation platform.

Some organizations try to whitelist only a few commands in sudoers. That can work for simple shell commands, and Ansible modules often execute transferred Python payloads and temporary files. A very narrow sudoers rule can break normal modules in surprising ways, so test the exact playbook path before treating the policy as ready.

When Ansible manages sudoers files, validate the file before installing it. The `validate` option runs a command against the temporary file, and Ansible only moves it into place when validation succeeds.

```yaml
- name: Install sudo rule for application deployment user
  ansible.builtin.copy:
    src: files/application-deploy.sudoers
    dest: /etc/sudoers.d/application-deploy
    owner: root
    group: root
    mode: "0440"
    validate: /usr/sbin/visudo -cf %s
  become: true
```

That validation step is small, and it protects against a painful outage. A malformed sudoers file can block future privileged automation, and the rollback may require console access or another break-glass path.

Access-control configuration deserves special treatment because it governs the mechanism used to repair itself. A broken application config may stop one service; a broken sudo or SSH rule can remove the automation path to the entire host. The rollout must preserve an old known-good path while proving the new one.

`validate` is stronger than “write, then check.” The module writes candidate content to a temporary path, substitutes that path for `%s`, and runs `visudo -cf`. Only a successful validation allows the atomic replacement. The active policy never passes through a known syntactically invalid state.

Syntax validation is necessary but not sufficient. A valid rule can still name the wrong user, omit a required command pattern, demand a password the controller does not have, or grant more privilege than intended. After installing on one canary, use the real automation credential to run both a normal module and the exact privileged task shape before widening.

Keep a second tested access route during the canary. That may be an existing automation key, an independent administrator session, a cloud console, or an out-of-band management path. Do not close the old session or revoke the old rule until the new route has completed a round trip.

SSH configuration has the same self-lockout risk. Validate daemon configuration with the platform's syntax command, place the candidate safely, reload rather than abruptly replace the running daemon where appropriate, and open a new connection before ending the old one. A syntactically valid SSH configuration can still reject the intended key or bind the wrong interface.

A narrow rollout for access changes usually means one non-critical canary, explicit `--limit`, validation, a new connection, privilege testing, and only then a small batch. `serial` can keep later hosts reachable even if one canary fails. Access policy is not the place for a first-ever all-host run.

The sudo rule should also match Ansible's real execution style. Command-specific restrictions can be useful, but modules may invoke Python, temporary files, package helpers, or service managers rather than the literal command visible in the task name. Test least-privilege policies against the exact roles and execution environment instead of reasoning only from human-facing YAML.

## How Do You Read and Roll Back Access Failures?
<!-- section-summary: Connection and privilege failures have different clues, so read the layer before changing settings. -->

An `UNREACHABLE` result usually points to transport. Check the inventory address, DNS, security groups or firewall rules, routing, SSH port, host key, private key, and login username. The run never reached useful task execution on the host, so changing `become` settings usually wastes time at this stage.

`Permission denied (publickey)` points to authentication. The login user, SSH key, authorized keys file, credential selection, or account state deserves attention. In a platform job, confirm which machine credential the job template used and whether the selected inventory host expects that user.

`Missing sudo password`, `user is not in the sudoers file`, or `become password is required` points to privilege escalation. The connection worked, and the host tried to run the task with elevated rights. Check `become`, `become_user`, sudoers, whether the job provided a become password, and whether the target system allows that escalation path.

Rollback depends on which layer changed. A bad `ansible_host` value rolls back through inventory. A bad SSH key rotation rolls back through the credential store or authorized keys management. A bad sudoers change should roll back through the previous validated sudoers file, and teams should keep a break-glass console or out-of-band access path for the rare case where sudo is broken.

A permission-denied message during the module is different from `UNREACHABLE`. The controller connected and began execution, but the current task identity could not access a file, socket, command, or service. Check whether the task needs `become`, whether it selected the correct `become_user`, and whether the desired resource permissions are themselves correct.

“Become password required” means the escalation method prompted but the job supplied no acceptable password. “User is not allowed to sudo” means the host policy rejected the login user's requested transition. Both occur after successful remote authentication, so rotating the SSH key will not repair them.

Common mistakes follow the same boundary confusion:

- Adding `become: true` everywhere hides which tasks really need elevated permission.
- Assuming root is the only useful `become_user` can create application-owned files as the wrong account.
- Storing passwords or private keys in plaintext inventory exposes controller credentials as ordinary data.
- Disabling host-key checking fixes a trust failure by removing server authentication.
- Running the controller as root is mistaken for remote root authorization.
- Changing sudo and SSH policy across the fleet removes the safe canary and fallback path.

When the error remains ambiguous, increase verbosity only as much as needed and protect the resulting logs. Verbose SSH output can reveal hostnames, users, key paths, proxy commands, and environment details. It helps identify the selected connection plugin and authentication attempts, but it should not become a broadly shared production artifact.

Rollback should restore the narrowest upstream source. Fix the address in inventory, the authorized key through its owner, the controller credential binding in the controller, or the validated access policy on the host. Then repeat the ladder from connectivity through privilege. A restored file is not enough until a new session proves the restored path.

## What Is the Complete Access Model?
<!-- section-summary: A clean connection setup names the host, logs in with one account, and escalates only where tasks need it. -->

The application platform now has a clean connection path. Inventory names `application-web-01`, `ansible_host` points to its private address, Ansible logs in as `deploy`, and privileged tasks use `become` only where they write protected files or manage services.


![Connection Privilege Summary](/content-assets/articles/article-infrastructure-as-code-ansible-connection-targets-privilege/connection-privilege-summary.png)

*The summary keeps the connection path concrete: target, login, key, privilege, test, and rollback.*

The team can test each layer before a deploy. `ping` proves connection and module execution, `whoami` proves the login user, `-b whoami` proves escalation, and a one-host check-mode run previews the playbook with the same inventory and credential choices.

That separation makes failures readable. Transport failures stay in the connection layer, key failures stay in authentication, and sudo failures stay in privilege escalation. Once the team can reach hosts safely, the next safety question is which subset of hosts should receive a change first.

A complete inventory and play make the identities visible without storing the credentials:

```yaml
# inventories/prod/hosts.yml
all:
  children:
    prod_web:
      vars:
        ansible_connection: ssh
        ansible_user: deploy
        ansible_become_method: sudo
      hosts:
        application-web-01:
          ansible_host: 10.42.10.11
        application-web-02:
          ansible_host: 10.42.10.12
```

```yaml
---
- name: Configure application web servers
  hosts: prod_web
  tasks:
    - name: Read the current login identity
      ansible.builtin.command: whoami
      register: login_identity
      changed_when: false

    - name: Install the application package
      ansible.builtin.package:
        name: application-api
        state: present
      become: true

    - name: Render application configuration
      ansible.builtin.template:
        src: application-api.yml.j2
        dest: /etc/application-api/config.yml
        owner: root
        group: application
        mode: "0640"
      become: true

    - name: Check the local health endpoint
      ansible.builtin.uri:
        url: http://127.0.0.1:9000/health
        status_code: 200
      changed_when: false
```

For the first task, the controller resolves `application-web-01` to `10.42.10.11`, uses the protected SSH credential to authenticate as `deploy`, transfers the module, and executes it without escalation. For the package and template tasks, the same connection remains open while sudo changes the execution identity to root. The health check returns to the ordinary login identity because it needs no protected filesystem or service access.

This example demonstrates why play-level root is not required. The unprivileged checks keep their smaller authority, while only the package and protected file cross the sudo boundary. The desired file owner can still be `root:application`; module execution identity and resulting ownership are separate choices.

A good preflight sequence mirrors the dependencies:

```bash
ansible-inventory -i inventories/prod --host application-web-01
ansible -i inventories/prod application-web-01 -m ansible.builtin.ping
ansible -i inventories/prod application-web-01 \
  -m ansible.builtin.command -a whoami
ansible -i inventories/prod application-web-01 -b \
  -m ansible.builtin.command -a whoami
ansible-playbook -i inventories/prod deploy-application-web.yml \
  --limit application-web-01 --check --diff
```

First inspect the resolved target, user, port, transport, and non-secret context. Then prove module execution as the login identity. Add escalation and prove the execution identity. Finally preview the real play on the same canary. If a step fails, stop there; higher steps depend on it.

The controller belongs inside this security model. It selects the inventory, binds credentials, verifies host keys, prepares code, and receives results. Protect its repository checkout, job templates, execution environment, secrets, logs, and launch permissions. A locked-down managed host can still be changed incorrectly if an attacker can combine a production credential with a malicious inventory or playbook on the controller.

The full safety model is a chain of explicit proofs:

```text
correct inventory identity
  + trusted server identity
  + approved login credential
  + allowed remote login
  + controlled escalation policy
  + least-privileged task scope
  + validated access changes
  + canary and fallback path
= a connection path suitable for production automation
```

The deepest conceptual separation is that connection and privilege solve different problems. The connection gets Ansible code to a managed node under an authenticated remote identity. Privilege escalation asks the managed node to authorize a different execution identity for selected work. One can succeed while the other fails, and their credentials, policies, diagnostics, and rollback paths remain distinct.

This distinction also keeps audit records meaningful. The controller can record who launched a job and which credential it bound. SSH logs can record that `deploy` authenticated. Sudo logs can record that `deploy` requested root for a module. The changed file can be owned by the application account. Collapsing all four identities into “Ansible ran as root” loses the chain that explains who initiated, authenticated, authorized, and ultimately owned the resource.

Dedicated automation accounts should be designed around that chain. Disable interactive passwords when key-only access is intended, restrict the source network where possible, manage `authorized_keys` centrally, review sudo policy, and rotate credentials without renaming inventory hosts. On the controller, restrict who can launch the credential and which inventories and playbooks it can be paired with. Least privilege exists on both sides of the SSH connection.

Bootstrap and recovery are mirror images. Bootstrap uses an initial trusted path to create the permanent automation identity and policy. Recovery uses a separately protected path when that permanent route is broken. Cloud console access, image rebuilds, or an out-of-band administrator account should be documented and tested enough that a malformed sudoers or SSH change does not turn into an improvised incident.

When becoming an unprivileged service user, pay attention to remote temporary-file readability. The login account may create a module payload, while the target service account must be able to execute it without exposing it broadly. Ansible has platform-dependent strategies for these transitions, and filesystem ACL support or group membership can matter. Test this case on the actual operating system and execution environment instead of treating it as identical to becoming root.

Connection plugins and become plugins preserve the same architecture beyond SSH and sudo. A transport plugin answers how the controller communicates with the target. A become plugin answers how an already established session changes execution identity. Supporting a Windows or network-device fleet changes the mechanisms, not the need to separate reachability, authentication, authorization, task identity, and rollback.

Finally, access configuration should never be broader than the target model. A secure SSH key used against an unverified inventory can still reach the wrong host. A carefully limited sudo policy applied to every host at once can still produce a fleet-wide lockout. Security controls reinforce one another only when inventory, credentials, host trust, privilege, and rollout boundaries are all explicit.

The shortest useful mental model is:

```text
connect as one authenticated identity
act as another authorized identity only for tasks that need it
validate any change to the path that makes both possible
```

Use configuration precedence carefully around this model. An `ansible_user` from inventory, a machine credential selected by a controller job, a play-level `remote_user`, and a CLI `-u` option can all influence the apparent login choice. Similarly, inventory may enable become while a task selects another `become_user`. When behavior differs between a laptop and CI, compare the resolved host data and controller credential binding before changing host policy.

Do not confuse a credential object with authorization on the host. Storing a become password in the controller only makes it available; sudoers still decides whether the authenticated login user may use it for the requested identity. Likewise, having the correct SSH private key only proves possession; the server account can still be locked, expired, limited by source address, or denied by its SSH configuration.

These distinctions make rollback safer. Restore trust material if server authentication changed, restore the login credential or `authorized_keys` if client authentication changed, restore inventory if reachability changed, and restore validated sudo or SSH policy if authorization changed. After each restoration, start a new connection and re-run the same layered tests. Existing sessions can remain alive after a policy change and give a false impression that fresh automation will succeed.

Treat every access test as evidence about one boundary, not as a general certificate of safety. Ping proves basic module execution, `whoami` proves one identity, an elevated command proves one escalation path, and a validated canary proves one rollout sample. Production confidence comes from joining those bounded proofs in order, while retaining a separate recovery route if the next boundary fails.

Inventory can contain many valid hosts, and the connection path can work for every one of them. A safe run still needs a precise target boundary. The next article shows how host patterns, `--limit`, and canary runs keep production changes small before they widen.

Proxy and bastion configuration adds another connection boundary. The runner must trust and authenticate the jump path as well as the final host, and debugging should identify which hop rejected the connection. Keep proxy commands and their credentials in the controller-side access model rather than disguising them as remote task behavior.

Connection multiplexing can reuse an established SSH session, which is efficient but can hide a changed credential or policy during testing. After rotating keys, host trust, or sudo configuration, open a genuinely new session and repeat the ladder. Success through an old control socket does not prove the next fresh automation job can connect.

Target proof comes before credential use. `ansible-playbook ... --list-hosts` should show the expected inventory identities after the play pattern and `--limit` intersect. Connection secrets such as `ansible_password` and escalation secrets such as `ansible_become_password` may be variables, but they should come from Vault or the controller's protected credential system rather than plaintext inventory. The resolved login identity, become identity, and host set together define the authority of the run.

## Check Your Answers

:::expand[Which Decisions Happen Before a Task Runs?]{kind="recap"}
Ansible resolves a target, authenticates a login identity, and optionally changes to a task execution identity. Each is a separate boundary with its own proof and failure modes.
:::

:::expand[How Does Ansible Choose the Target and Login User?]{kind="recap"}
Inventory and connection variables provide the address, plugin, port, user, and interpreter. Inspect resolved host data when a play keyword or CLI choice appears to lose.
:::

:::expand[How Do SSH Keys and Controller Credentials Differ?]{kind="recap"}
User keys prove the controller's login identity; host keys prove the server's identity. Protect both credential binding and trust data on the controller.
:::

:::expand[How Does Privilege Escalation Work?]{kind="recap"}
`become` requests a controlled identity transition after login. Use the right method and target user, keep escalation at the smallest accurate scope, and remember that host policy still decides.
:::

:::expand[How Do You Test Each Access Layer?]{kind="recap"}
Inspect inventory, ping, confirm the login user, confirm the become user, then test representative protected work on a canary through the actual controller path.
:::

:::expand[How Do You Change Sudo and SSH Safely?]{kind="recap"}
Validate candidate syntax before replacement, keep an old access path open, prove a new session and real module behavior on one host, then widen gradually.
:::

:::expand[How Do You Read and Roll Back Access Failures?]{kind="recap"}
`UNREACHABLE`, authentication rejection, task permission errors, and become rejection point to different layers. Restore the owning source and re-test the whole dependency ladder.
:::

:::expand[What Is the Complete Access Model?]{kind="recap"}
Production access combines trusted identity, controller-side credentials, remote authentication, controlled authorization, least privilege, validation, canaries, and a fallback path.
:::

---

**References**

- [Connection methods and details](https://docs.ansible.com/projects/ansible/latest/inventory_guide/connection_details.html)
- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html)
- [Understanding privilege escalation: become](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_privilege_escalation.html)
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html)
- [Introduction to ad hoc commands](https://docs.ansible.com/projects/ansible/latest/command_guide/intro_adhoc.html)
- [ansible-playbook command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html)
- [Red Hat Ansible Automation Platform job templates](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/controller-job-templates)
