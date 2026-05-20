---
title: "Ansible in CI"
description: "Use CI to check Ansible changes, show review evidence, and keep production runs behind protected jobs."
overview: "CI helps Ansible changes become easier to review when it records syntax checks, target scope, safe previews, and run artifacts without giving every pull request production authority."
tags: ["ansible", "ci", "check-mode"]
order: 1
id: article-infrastructure-as-code-ansible-in-ci
---

## Table of Contents

1. [What CI Can Prove](#what-ci-can-prove)
2. [The Runner Is a Control Node](#the-runner-is-a-control-node)
3. [Review Jobs](#review-jobs)
4. [Check Mode and Diff Mode](#check-mode-and-diff-mode)
5. [Deployment Jobs](#deployment-jobs)
6. [Evidence to Keep](#evidence-to-keep)
7. [Where CI Breaks](#where-ci-breaks)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What CI Can Prove

Continuous integration, usually shortened to CI, is the system that runs checks when code changes. In application code, CI might run unit tests or build a container image. With Ansible, the goal is different. Ansible changes often describe real changes to real machines, so a useful CI job should answer a few careful questions before anyone points the playbook at production.

For the orders service, imagine a pull request that changes two files. The Nginx template now sends traffic to port `8081` instead of `8080`, and the systemd unit adds one environment variable for a new feature flag. A reviewer can read those files, but the important question is what Ansible will do with them after inventory, variables, templates, tags, limits, and configuration are all loaded together.

CI can make that visible. It can prove that Ansible can parse the playbook. It can show which hosts the command would select. It can run a preview against a staging host. It can save a small diff showing the public file changes that Ansible expects to make.

CI cannot prove everything. A syntax check does not prove that the orders service will start. A dry run cannot predict every task, especially when later tasks depend on values registered by earlier tasks. A green pull request job also does not mean the same command is safe for production. The job is useful because it creates review evidence, not because it removes the need for deployment boundaries.

That distinction is the central idea in this article. Use CI to make Ansible behavior visible. Give production authority only to jobs that are meant to deploy.

## The Runner Is a Control Node

Ansible has a control node and managed nodes. The control node is where Ansible runs. It reads the playbook, loads inventory, evaluates variables, decrypts Vault content when it has the password, connects to managed hosts, and asks those hosts to reach the desired state.

When Ansible runs in CI, the CI runner becomes the control node for that job. This is easy to miss because the runner feels temporary. The job starts, checks out the repository, runs a few commands, uploads artifacts, and disappears. During that short time, though, it has the same kind of authority as any other Ansible control node with the same inventory, secrets, and network path.

That means the runner environment matters. The active Ansible version matters. The active `ansible.cfg` file matters. Environment variables can change behavior before the playbook starts. Ansible configuration can come from `ANSIBLE_CONFIG`, an `ansible.cfg` in the current directory, the user's home directory, or `/etc/ansible/ansible.cfg`, and Ansible uses the first one it finds.

Before a CI job shows anything about the orders playbook, it should record the control-node view it is using. This command does not contact hosts. It shows the installed Ansible version and the active configuration file path.

```bash
ansible --version
```

A saved output might include lines like these:

```text
ansible [core 2.16.4]
  config file = /workspace/ansible.cfg
  python version = 3.11.7
```

Those lines are small, but they explain a lot when a job behaves differently from a developer laptop. If the runner used `/etc/ansible/ansible.cfg` instead of the repository config, reviewers should know that before trusting the rest of the output.

## Review Jobs

A review job is the pull request job. Its job is to help people review the proposed change. It should not have production SSH keys, production Vault passwords, or a route to production hosts. If a pull request job receives those things, then a normal review check has quietly become a deployment surface.

The first useful check is syntax. A syntax check confirms that Ansible can parse the playbook and supporting files well enough to start. It does not execute the playbook.

```bash
ansible-playbook -i inventories/ci.ini playbooks/orders.yml --syntax-check
```

This is similar to asking a compiler whether the file is shaped correctly. It catches broken YAML, invalid playbook structure, and some early mistakes. It does not tell you whether `orders-web-01` is reachable, whether a service restart will succeed, or whether a template variable has the intended value in production.

After syntax, reviewers need to know scope. Inventory turns a play such as `hosts: orders_web` into a real host list. That host list can come from a static inventory file, a dynamic inventory plugin, group membership, variables, and command-line limits. The command can look familiar while the resolved host set changes.

For a pull request, use a CI or staging inventory and record the selected hosts before any preview run.

```bash
ansible-playbook -i inventories/staging.ini playbooks/orders.yml \
  --list-hosts \
  --limit orders-web-01
```

The useful output is direct:

```text
playbook: playbooks/orders.yml

  play #1 (orders_web): Configure orders web nodes	TAGS: []
    pattern: ['orders_web']
    hosts (1):
      orders-web-01
```

The important line is `hosts (1)`. The reviewer can see that this job is scoped to one staging host. If the output says `hosts (0)`, the preview will not prove anything about the orders service. If it says `hosts (12)`, the job is wider than the command name may have suggested.

## Check Mode and Diff Mode

After syntax and scope, the next step is a preview. Ansible check mode asks modules to report changes they would make without changing the remote system. Diff mode asks modules that support diffs to show before-and-after text for small files and templates. Together, they are useful for configuration files like the orders Nginx site.

The preview command should run after the reader knows three things: which inventory is being used, which host limit was selected, and which secrets are available to the job. For the orders service, a pull request preview might use one staging host.

```bash
ansible-playbook -i inventories/staging.ini playbooks/orders.yml \
  --check \
  --diff \
  --limit orders-web-01
```

For the Nginx template change, diff output can show the public text that would change:

```diff
- set $orders_backend "127.0.0.1:8080";
+ set $orders_backend "127.0.0.1:8081";
```

That is good review evidence. The reviewer can connect the pull request to the rendered file that Ansible expects to place on the host. The diff proves more than "the YAML parsed" because it shows how variables and templates came together for one selected host.

Check mode still has limits. It is a simulation. Modules that support check mode can predict changes, but modules that do not support it may report nothing. Tasks that depend on registered results from earlier tasks can also be less useful in check mode because the earlier task may not have produced the same result it would produce during a real run.

Diff mode has a different surprise. It can reveal sensitive values. A public Nginx port change is useful to show. A rendered file containing database passwords is not. Tasks that handle secrets should use `no_log: true` when their output could expose sensitive data, and file tasks that would produce secret diffs should disable diffs with `diff: false`.

For the orders service, the public Nginx site can show a diff. The secret environment file should not.

```yaml
- name: Render orders secret environment
  ansible.builtin.template:
    src: orders.env.j2
    dest: /etc/orders/orders.env
    mode: "0600"
  no_log: true
  diff: false
```

The preview is strongest when it shows the safe parts clearly and hides the secret parts deliberately. A job that prints every rendered file is not better evidence. It is a leak waiting to happen.

## Deployment Jobs

A deployment job has a different purpose from a review job. It is allowed to change systems. That means it may receive production inventory, a production SSH key, a production Vault password, and network access to production hosts. Treat that job as an operational action, not as another pull request check.

The first production deployment for the orders change should be narrow. A canary run applies to one host first. Health checks and service checks happen before the run widens to the rest of the group.

The command below has production authority because it uses the production inventory and the production Vault identity. The `--limit` makes the selected host narrow, but it does not remove the authority behind the job.

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --vault-id prod@.vault-pass-prod \
  --limit orders-web-01
```

After the canary is healthy, a later job can widen the limit to the group:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --vault-id prod@.vault-pass-prod \
  --limit orders_web
```

The playbook's execution controls still matter. If the play uses `serial: 1`, Ansible completes the play on one host before moving to the next. If the play has no batching and the selected group contains many hosts, the run can affect the whole group together. `--limit` chooses which hosts are eligible. `serial` controls how many of those hosts are handled in each batch.

This distinction matters for the orders service. A limit of `orders_web` plus `serial: 1` is a rolling deployment. A limit of `orders_web` without batching can restart every web node in the group during the same play. CI should make that difference visible in the job definition and in the saved evidence.

## Evidence to Keep

Good CI evidence is small enough for a reviewer to read. It should answer what ran, where it ran, which hosts were selected, and what the result was. It should not contain private keys, passwords, tokens, or full rendered secret files.

A simple artifact set for the orders service might look like this:

```text
artifacts/
  ansible-version.txt
  ansible-syntax.txt
  ansible-list-hosts.txt
  ansible-check-diff.txt
  ansible-recap.txt
```

The version file explains the control node:

```text
ansible [core 2.16.4]
config file = /workspace/ansible.cfg
```

The host list explains scope:

```text
inventory: inventories/staging.ini
limit: orders-web-01
hosts (1):
  orders-web-01
```

The recap explains the outcome:

```text
PLAY RECAP *********************************************************************
orders-web-01 : ok=14 changed=3 unreachable=0 failed=0 skipped=2 rescued=0 ignored=0
```

For a production apply, the artifact should also record the commit, inventory, limit, Vault identity label, mode, and health result. It should say enough for another engineer to answer, "Which commit changed `orders-web-01`, and did the health check pass?"

```text
job: deploy-orders-production
commit: 8f3c2ad
inventory: inventories/prod.ini
limit: orders-web-01
vault-id: prod
mode: apply
health: orders-web-01 /healthz 200
```

The Vault identity label is useful evidence, but the Vault password is never evidence. The private key is never evidence. The rendered secret environment file is never evidence.

## Where CI Breaks

CI breaks when the same job is expected to be both a safe review check and a production deployer. The review job should not receive production authority. If it cannot reach production, cannot decrypt production variables, and cannot log in to production hosts, then a mistake in the review job is contained.

CI also breaks when host scope is hidden. A green check that never recorded `--list-hosts` tells reviewers little about blast radius. The playbook could have selected one host, zero hosts, or a whole group. Recording the resolved hosts turns an invisible assumption into a visible fact.

Configuration drift is another common problem. A changed runner image, an unexpected `ANSIBLE_CONFIG`, or a different `ansible.cfg` can change connection behavior, callbacks, inventory defaults, or host key handling. The job should record `ansible --version` and keep important environment variables explicit in the job definition.

Secret cleanup is easy to overlook. A job may write a Vault password to a temporary file so `ansible-playbook` can read it. If the playbook fails, cleanup still needs to run. The safest pattern is to create secret files with restrictive permissions, use them for the shortest possible time, and delete them in a cleanup step that runs after success or failure.

Finally, check mode output can be overtrusted. It is a preview, not a guarantee. It is best at showing configuration-management changes on a small host set. It is weaker when tasks call external systems, depend on earlier command results, or use modules without good check-mode support.

## Putting It All Together

The orders pull request starts as a review problem. CI records the Ansible version, runs a syntax check, lists the staging canary host, and previews public diffs for the Nginx template. It hides secret output. It does not receive production credentials.

The production deployment is a separate job. It runs only after approval. It receives the production inventory, production connection credentials, and the `prod` Vault identity. It lists the production host it will touch, applies to one host first, records the recap, and keeps the health result. Only after that can the run widen to the `orders_web` group, with batching controlled by the playbook.

CI helps here because it makes Ansible behavior reviewable. It stays safe when review evidence and production authority are separated.

## What's Next

The next article names those boundaries directly: where Ansible is allowed to run, which inventory it can target, which credentials it receives, and what approval must happen before the orders service can be changed.

---

**References**

- [ansible-playbook command line reference](https://docs.ansible.com/ansible/latest/cli/ansible-playbook.html)
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html)
- [Ansible configuration settings](https://docs.ansible.com/ansible/latest/reference_appendices/config.html)
- [How to build your inventory](https://docs.ansible.com/ansible/latest/inventory_guide/intro_inventory.html)
- [Logging Ansible output](https://docs.ansible.com/ansible/latest/reference_appendices/logging.html)
- [Controlling playbook execution: strategies and more](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_strategies.html)
