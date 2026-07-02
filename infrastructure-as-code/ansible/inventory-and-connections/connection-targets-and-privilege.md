---
title: "Connections and Privilege Escalation"
description: "Understand how Ansible chooses the host address, login user, and privilege escalation user."
overview: "Ansible connection failures are easier to read when address, login, and privilege are separate ideas."
tags: ["ansible", "ssh", "become", "privilege"]
order: 3
id: article-infrastructure-as-code-ansible-connection-targets-privilege
---

## Table of Contents

1. [Three Decisions Before a Task Runs](#three-decisions-before-a-task-runs)
2. [The Connection Target](#the-connection-target)
3. [The Login User](#the-login-user)
4. [Keys, Host Keys, and Controller Credentials](#keys-host-keys-and-controller-credentials)
5. [Privilege Escalation with become](#privilege-escalation-with-become)
6. [Testing Each Layer](#testing-each-layer)
7. [Safe Sudo Changes](#safe-sudo-changes)
8. [Failure Reading and Rollback](#failure-reading-and-rollback)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Three Decisions Before a Task Runs
<!-- section-summary: Ansible connection behavior is easier to debug when target, login user, and privilege user stay separate. -->

Before Ansible can change a protected file on a Linux host, it has to make three decisions. It chooses **where to connect**, **which remote user logs in**, and **which user runs the task after privilege escalation**. These decisions often get mixed together, and that is why a simple failure can feel like several different problems at once.


![Connection Decision Stack](/content-assets/articles/article-infrastructure-as-code-ansible-connection-targets-privilege/connection-decision-stack.png)

*The decision stack separates the target host, connection address, login user, SSH key, elevated user, and final task.*

For the orders platform, Ansible connects to `orders-web-01` over SSH using a private address. It logs in as the `deploy` user because that account is managed by the image build and deployment process. When a task needs to write `/etc/orders/orders.yml` or restart `orders-web.service`, Ansible escalates with `become` so the task can run with root privileges.

Keeping those layers separate gives you a practical debugging path. A private IP or DNS problem belongs to the connection target. A rejected SSH key belongs to the login user and credentials. A sudo prompt or permission denied error after the task starts belongs to privilege escalation.

Here is the production shape in one place:

```yaml
orders-web-01:
  ansible_host: 10.42.10.11
  ansible_user: deploy
  ansible_port: 22
  ansible_ssh_private_key_file: ~/.ssh/orders-prod-deploy
  ansible_become: true
  ansible_become_method: sudo
  ansible_become_user: root
```

Local CLI runs may use the key path directly. Controller jobs usually store the SSH key and become password in a credential object, then inventory keeps only the host, user, and privilege intent. That split keeps secrets out of content while keeping the access model visible during review.

## The Connection Target
<!-- section-summary: The connection target tells Ansible the address, port, and transport for a managed node. -->

The **connection target** is the address and transport Ansible uses to reach a host. For Linux fleets, that usually means SSH to a private IP address or private DNS name. The inventory name can stay stable, while `ansible_host` points to the current reachable address.

```yaml
prod_web:
  hosts:
    orders-web-01:
      ansible_host: 10.42.10.11
      ansible_port: 22
    orders-web-02:
      ansible_host: 10.42.10.12
      ansible_port: 22
```

This is useful during replacements. If `orders-web-01` is rebuilt and receives a new private IP, the team updates `ansible_host` or lets dynamic inventory produce the new value. Play output, host variables, and runbooks can still use the stable inventory name.

Connection settings can come from inventory variables, Ansible configuration, command-line options, and environment variables. When the behavior surprises you, inspect the compiled host first because it shows what Ansible loaded for that host.

```bash
ansible-inventory -i inventories/prod --host orders-web-01
```

If the host output shows the wrong address or port, fix inventory before reading playbook tasks. The task file has no chance to work when the transport points at the wrong machine.

## The Login User
<!-- section-summary: The login user authenticates to the remote host before become changes task privileges. -->

The **login user** is the account Ansible uses to start the remote session. For SSH, this might be `deploy`, `ubuntu`, `ec2-user`, `ansible`, or another account your image pipeline creates. In inventory, this is usually `ansible_user`.

```yaml
prod_web:
  vars:
    ansible_user: deploy
  hosts:
    orders-web-01:
      ansible_host: 10.42.10.11
    orders-web-02:
      ansible_host: 10.42.10.12
```

The login user needs enough access to authenticate, create Ansible's temporary files, run Python modules, and read basic system facts. The application user and the root user can stay separate from this login account. Many teams use a locked-down deployment account with SSH keys, then use `become` only for tasks that need elevated permissions.

This distinction matters during offboarding and incident response. If the `deploy` private key is rotated, SSH access changes. If the sudo policy changes, privileged task execution changes. Treating those as separate controls makes audits and break-fix work much cleaner.

## Keys, Host Keys, and Controller Credentials
<!-- section-summary: SSH credentials prove who Ansible is, while host keys help prove which machine Ansible reached. -->

Ansible usually authenticates over SSH with a private key. In a local project, the key path might live in inventory for a lab, although production teams often prefer controller-managed credentials or CI secrets so shared inventory never carries private key paths.

```yaml
prod_web:
  vars:
    ansible_user: deploy
    ansible_ssh_private_key_file: ~/.ssh/orders-prod-deploy
```

In Red Hat Ansible Automation Platform or AWX-style workflows, the inventory normally describes hosts and groups, while a machine credential supplies the SSH username, private key, and optional become password at job launch. That split keeps secrets out of content repositories and lets platform administrators control who can run which credential against which inventory.

Host key verification checks that the SSH server Ansible reached is the machine you expected. Production automation should manage known hosts intentionally so convenience never removes that protection. A common pipeline step is to populate a controlled `known_hosts` file from trusted provisioning output or a secure source of host fingerprints.

```bash
ssh-keyscan orders-web-01.internal.example.com >> ./known_hosts
ANSIBLE_HOST_KEY_CHECKING=True ANSIBLE_SSH_ARGS="-o UserKnownHostsFile=./known_hosts" \
  ansible -i inventories/prod orders-web-01 -m ansible.builtin.ping
```

That example shows the idea, and the trust source matters. `ssh-keyscan` alone reads what the network presents at that moment, so production teams should compare fingerprints against provisioning records, cloud instance data, configuration management records, or another trusted channel.

For production, a reviewed `known_hosts` file is safer than turning off host key checking. Some teams generate it from trusted infrastructure data during the pipeline, then store it as a short-lived CI workspace file. Others manage it as part of the bastion or controller setup. The runner should know which host key belongs to `10.42.10.11` before the playbook starts changing `/etc`.

## Privilege Escalation with become
<!-- section-summary: become runs selected tasks as another user after the SSH login succeeds. -->

**Privilege escalation** means Ansible logs in as one user and runs a task as another user. Ansible calls this `become`. On Linux, `become` usually uses sudo, although Ansible supports other escalation tools on different platforms.


![Privilege Escalation Boundary](/content-assets/articles/article-infrastructure-as-code-ansible-connection-targets-privilege/privilege-escalation-boundary.png)

*The privilege boundary shows the difference between logging in normally and crossing a controlled sudo boundary for root-level work.*

```yaml
- name: Configure orders web servers
  hosts: prod_web
  tasks:
    - name: Render app config
      ansible.builtin.template:
        src: orders.yml.j2
        dest: /etc/orders/orders.yml
        owner: root
        group: orders
        mode: "0640"
      become: true

    - name: Check local health endpoint
      ansible.builtin.uri:
        url: http://127.0.0.1:9000/health
        return_content: false
```

In this play, the config task needs elevated filesystem access, so it uses `become: true`. The health check runs as the login user because it only calls a local HTTP endpoint. Keeping escalation close to the task makes the review clearer because readers can see exactly which work needs extra privilege.

`become_user` controls which user the task uses after privilege escalation. The default is usually root. A task might use `become_user: orders` when it should run as the application account, such as a command that writes user-owned cache files or runs an application migration tool.

```yaml
- name: Run orders database migration as the service account
  ansible.builtin.command: /opt/orders/bin/orders migrate
  become: true
  become_user: orders
```

The login user still exists in this flow. Ansible connects as `deploy`, then escalates for that task. That explains many confusing failures: SSH can work while sudo fails, and sudo can work while a specific `become_user` lacks access to the target file or command.

## Testing Each Layer
<!-- section-summary: Small commands can prove the connection, login identity, and become behavior before a full playbook runs. -->

Test the path in layers. First, confirm Ansible can connect and run a small module as the login user. This checks inventory, SSH, key authentication, Python discovery, and basic module execution.

```bash
ansible -i inventories/prod prod_web -m ansible.builtin.ping
```

Then ask the host which user is running without escalation. This is a simple way to confirm `ansible_user` and credential selection.

```bash
ansible -i inventories/prod orders-web-01 -m ansible.builtin.command -a whoami
```

After that, test escalation. The `-b` flag enables become for the ad hoc command.

```bash
ansible -i inventories/prod orders-web-01 -b -m ansible.builtin.command -a whoami
```

A healthy path usually prints `deploy` for the second command and `root` for the third command. If the first command fails, fix connection and login. If the first two work and the third fails, focus on sudo policy, become configuration, become password handling, or the requested `become_user`.

For playbooks, use `--check` when supported and narrow to one host before the first production change. Check mode covers only modules and side effects that support it, and it still gives useful evidence before a real canary run.

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml --limit orders-web-01 --check --diff
```

## Safe Sudo Changes
<!-- section-summary: Sudo policy changes deserve validation because a bad rule can lock automation out of privileged work. -->

The sudo policy is part of the automation contract. The `deploy` user may be able to log in, and privileged tasks still need a sudo rule that allows the required escalation. In many production Ansible environments, teams allow controlled automation users to run passwordless sudo through a protected credential path, then restrict who can launch that credential in the automation platform.

Some organizations try to whitelist only a few commands in sudoers. That can work for simple shell commands, and Ansible modules often execute transferred Python payloads and temporary files. A very narrow sudoers rule can break normal modules in surprising ways, so test the exact playbook path before treating the policy as ready.

When Ansible manages sudoers files, validate the file before installing it. The `validate` option runs a command against the temporary file, and Ansible only moves it into place when validation succeeds.

```yaml
- name: Install sudo rule for orders deployment user
  ansible.builtin.copy:
    src: files/orders-deploy.sudoers
    dest: /etc/sudoers.d/orders-deploy
    owner: root
    group: root
    mode: "0440"
    validate: /usr/sbin/visudo -cf %s
  become: true
```

That validation step is small, and it protects against a painful outage. A malformed sudoers file can block future privileged automation, and the rollback may require console access or another break-glass path.

## Failure Reading and Rollback
<!-- section-summary: Connection and privilege failures have different clues, so read the layer before changing settings. -->

An `UNREACHABLE` result usually points to transport. Check the inventory address, DNS, security groups or firewall rules, routing, SSH port, host key, private key, and login username. The run never reached useful task execution on the host, so changing `become` settings usually wastes time at this stage.

`Permission denied (publickey)` points to authentication. The login user, SSH key, authorized keys file, credential selection, or account state deserves attention. In a platform job, confirm which machine credential the job template used and whether the selected inventory host expects that user.

`Missing sudo password`, `user is not in the sudoers file`, or `become password is required` points to privilege escalation. The connection worked, and the host tried to run the task with elevated rights. Check `become`, `become_user`, sudoers, whether the job provided a become password, and whether the target system allows that escalation path.

Rollback depends on which layer changed. A bad `ansible_host` value rolls back through inventory. A bad SSH key rotation rolls back through the credential store or authorized keys management. A bad sudoers change should roll back through the previous validated sudoers file, and teams should keep a break-glass console or out-of-band access path for the rare case where sudo is broken.

## Putting It All Together
<!-- section-summary: A clean connection setup names the host, logs in with one account, and escalates only where tasks need it. -->

The orders platform now has a clean connection path. Inventory names `orders-web-01`, `ansible_host` points to its private address, Ansible logs in as `deploy`, and privileged tasks use `become` only where they write protected files or manage services.


![Connection Privilege Summary](/content-assets/articles/article-infrastructure-as-code-ansible-connection-targets-privilege/connection-privilege-summary.png)

*The summary keeps the connection path concrete: target, login, key, privilege, test, and rollback.*

The team can test each layer before a deploy. `ping` proves connection and module execution, `whoami` proves the login user, `-b whoami` proves escalation, and a one-host check-mode run previews the playbook with the same inventory and credential choices.

That separation makes failures readable. Transport failures stay in the connection layer, key failures stay in authentication, and sudo failures stay in privilege escalation. Once the team can reach hosts safely, the next safety question is which subset of hosts should receive a change first.

## What's Next

Inventory can contain many valid hosts, and the connection path can work for every one of them. A safe run still needs a precise target boundary. The next article shows how host patterns, `--limit`, and canary runs keep production changes small before they widen.

---

**References**

- [Connection methods and details](https://docs.ansible.com/projects/ansible/latest/inventory_guide/connection_details.html)
- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html)
- [Understanding privilege escalation: become](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_privilege_escalation.html)
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html)
- [Introduction to ad hoc commands](https://docs.ansible.com/projects/ansible/latest/command_guide/intro_adhoc.html)
- [ansible-playbook command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html)
- [Red Hat Ansible Automation Platform job templates](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/controller-job-templates)
