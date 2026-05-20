---
title: "Execution Boundaries"
description: "Define who can run Ansible, which inventory they can target, which credentials they receive, and how approval limits blast radius."
overview: "Automation is safe when authority is explicit across control nodes, inventories, credentials, approvals, host limits, batches, and run evidence."
tags: ["ansible", "automation", "credentials"]
order: 2
id: article-infrastructure-as-code-ansible-execution-boundaries
---

## Table of Contents

1. [What Is an Execution Boundary?](#what-is-an-execution-boundary)
2. [Control Nodes](#control-nodes)
3. [Inventories](#inventories)
4. [Credentials](#credentials)
5. [Approval Gates](#approval-gates)
6. [Limits and Batches](#limits-and-batches)
7. [Run Evidence](#run-evidence)
8. [Where Boundaries Break](#where-boundaries-break)
9. [Putting It All Together](#putting-it-all-together)

## What Is an Execution Boundary?

Ansible files do not change servers by themselves. A playbook can sit in a repository for months and do nothing. Change happens when someone or something runs Ansible from a control node with an inventory, credentials, configuration, and a path to the managed hosts.

An execution boundary is the line around that authority. It answers a simple question: what is this Ansible run allowed to reach and change?

For the orders service, a deployment command may look small:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --vault-id prod@.vault-pass-prod \
  --limit orders-web-01
```

The command is short, but it carries several decisions. The runner can read `inventories/prod.ini`. It has a password source for the `prod` Vault identity. It has credentials that can connect to `orders-web-01`. It can probably become a privileged user on that host. It has network access from the control node to the server.

The boundary is not one setting. It is the combination of those pieces. A safe automation design makes each piece visible and gives each environment only the authority it needs.

## Control Nodes

The control node is the machine where Ansible runs. It may be a developer laptop, a CI runner, a bastion host, or an automation controller. The managed nodes are the machines Ansible connects to and changes.

This distinction matters because authority begins at the control node. If a laptop has the production SSH key, the production Vault password, and network access to the orders production hosts, then that laptop has production authority. Calling it a development laptop does not make it safe. The reach of the machine is what matters.

A useful boundary starts by naming the control points and their purpose.

| Control node | Normal purpose | Expected reach |
| --- | --- | --- |
| Developer laptop | Build roles and test local changes | Lab or development hosts |
| Pull request runner | Parse, list, and preview changes | CI or staging only |
| Protected deployment runner | Apply approved changes | Production after approval |
| Break-glass host | Emergency operations | Restricted production access |

The table is only documentation unless access rules match it. A pull request runner should not have a route to production hosts. A developer laptop should not silently share the same Vault password as the production deploy job. A break-glass host should be rare, logged, and more tightly controlled than a normal deploy path.

Before a run, record which control node view Ansible is using:

```bash
ansible --version
```

The output shows the Ansible version and active configuration file. That matters because configuration can change behavior before the playbook reads its first task. Ansible searches for configuration in a defined order, including `ANSIBLE_CONFIG`, a local `ansible.cfg`, a home-directory config, and `/etc/ansible/ansible.cfg`. Two control nodes can run the same command and behave differently if they load different configuration.

## Inventories

Inventory is the map from Ansible names to real managed hosts. A play can say `hosts: orders_web`, but the inventory decides which machines belong to that group today. Inventory can be a static file, several files, a directory, or a dynamic source.

For a simple orders setup, separate inventories make the environment boundary visible:

```text
inventories/
  ci.ini
  staging.ini
  prod.ini
```

That layout helps humans avoid mistakes, but the file names are not the boundary by themselves. The boundary comes from which jobs can read which files, which variables each inventory loads, and which credentials are paired with each environment.

Ansible's inventory guide recommends defining only one environment in each inventory when you manage multiple environments. That reduces the chance that a command meant for staging changes a production node. It also makes review output clearer because `-i inventories/staging.ini` and `-i inventories/prod.ini` are different decisions.

Inventory can surprise teams in two ways. First, a group name can select more hosts than expected when dynamic inventory, cloud tags, or group membership changes. Second, multiple inventory sources can merge variables, and load order can decide which value wins. A production inventory accidentally combined with a staging source can produce a target set or variable set that nobody intended.

Before applying the orders playbook, record the resolved host list:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --list-hosts \
  --limit orders-web-01
```

The useful result is small:

```text
hosts (1):
  orders-web-01
```

That output is the inventory boundary made visible. It does not change anything, but it shows what the later command would be able to target with the same inventory and limit.

## Credentials

Credentials turn a map into access. Inventory can name `orders-web-01`, but Ansible still needs a way to connect to that host and a way to perform privileged changes when the playbook requires them.

For server automation, the main credential types are ordinary connection credentials, privilege escalation credentials, Vault passwords, and any external tokens used by tasks.

| Credential | What it allows |
| --- | --- |
| SSH key or connection password | Log in to managed hosts |
| Become permission or password | Run privileged tasks on managed hosts |
| Vault password or Vault ID source | Decrypt encrypted variables and files |
| Package, registry, or cloud token | Let tasks call external systems |

Separate these by environment. A staging SSH key should not also log in to production. A production Vault password should not be available to pull request jobs. Generic names such as `ANSIBLE_SSH_KEY` hide authority. Names such as `ANSIBLE_SSH_KEY_PROD` and `ANSIBLE_VAULT_PASSWORD_PROD` are longer, but they make the environment visible in the job definition.

Vault deserves special care. A Vault ID is a label that helps Ansible and humans choose the right password source. The common pattern is `label@source`.

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --vault-id prod@.vault-pass-prod \
  --limit orders-web-01
```

In that command, `prod` is the label and `.vault-pass-prod` is the source. The label is useful, but it is not a full access-control system by itself. Ansible documentation explains that Vault ID labels are hints unless matching is enforced with configuration, and even with matching enabled, Ansible does not enforce that the same label always uses the same password. The operational boundary should still come from secret storage, job permissions, and environment-specific password sources.

When a CI job writes a password source to disk, treat that file as a secret file:

```bash
install -m 0600 /dev/null .vault-pass-prod
printf "%s" "$ANSIBLE_VAULT_PASSWORD_PROD" > .vault-pass-prod
```

The file should be removed after the run, including after failure. Also remember that Vault keeps content encrypted at rest, but when encrypted files are copied or templated to target hosts with the right password, the result on the target can be decrypted by design. Vault protects repository content and secret transport through the control flow. It does not mean every file on the managed host remains encrypted.

## Approval Gates

Approval is the point where a protected job receives authority it did not have before. A pull request review approves the code change. A production environment approval allows a runner to receive production inventory, production credentials, and a network path to production hosts. Those gates should be separate because they answer different questions.

For the orders service, a pull request reviewer might approve the Nginx port change after seeing a staging diff. That does not mean the reviewer has approved an immediate restart of every production web node. The deployment approval should happen at the point where the production job is about to receive production secrets.

A good approval gate is narrow and visible:

```text
job: deploy-orders-production
requires: production approval
inventory: inventories/prod.ini
vault-id: prod
initial limit: orders-web-01
```

The approval does not make the playbook safe by itself. It only releases the authority to run. The job still needs a narrow limit, a known batch size, health checks, and evidence.

## Limits and Batches

Ansible has two controls that people often mix together: host selection and batching.

Host selection decides which hosts are eligible for the run. The inventory and play's `hosts:` value create the first selection. The command-line `--limit` narrows that selection further.

Batching decides how many selected hosts Ansible handles at a time. The `serial` keyword controls batch size for a play. By default, Ansible can run tasks across all hosts affected by the play using its normal forks behavior. With `serial`, it completes the play on one batch before moving to the next batch.

For the first orders production run, host selection should be one host:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --vault-id prod@.vault-pass-prod \
  --limit orders-web-01
```

After the canary passes, host selection can widen:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --vault-id prod@.vault-pass-prod \
  --limit orders_web
```

If the playbook contains `serial: 1`, the wider run still moves one host at a time:

```yaml
- name: Deploy orders web nodes
  hosts: orders_web
  serial: 1
  tasks:
    - name: Render Nginx site
      ansible.builtin.template:
        src: orders.nginx.conf.j2
        dest: /etc/nginx/conf.d/orders.conf
```

The practical surprise is that `--limit orders_web` and `serial: 1` do different jobs. The limit says the run may touch the `orders_web` group. The serial setting says the play should move through that selected group one host at a time. If the group has eight hosts, the authority covers eight hosts even though the batch size is one.

## Run Evidence

Every meaningful run should leave a record that answers operational questions later. The record should be boring and specific. Which commit ran? Which control node configuration did it use? Which inventory and limit selected the hosts? Which Vault label was supplied? What did the recap say? Did the health check pass?

For the orders canary, a useful record might look like this:

```text
job: deploy-orders-production
commit: 8f3c2ad
ansible: core 2.16.4
config: /workspace/ansible.cfg
inventory: inventories/prod.ini
limit: orders-web-01
vault-id: prod
mode: apply
recap: ok=14 changed=3 unreachable=0 failed=0
health: orders-web-01 /healthz 200
```

That record is enough to reconstruct the run without exposing secrets. It does not include the private key. It does not include the Vault password. It does not include a rendered secret environment file.

Logging has its own boundary. Ansible can print task arguments and output to the control node. If logs are saved, tasks that expose sensitive values should use `no_log: true`. That prevents many normal task values from appearing in output, but debugging output can still be dangerous. Production jobs should avoid debug tasks that print secret-bearing variables.

## Where Boundaries Break

Boundaries break when one credential works everywhere. A shared SSH key and a shared Vault password make job definitions shorter, but they make environment mistakes easier. If the staging job can use the production password by accident, the staging boundary is weak.

They break when inventory names are trusted more than resolved hosts. `orders_web` is a label. The host list behind it can change. A saved `--list-hosts` artifact shows what the run actually selected.

They break when `--limit` is treated as the only safety control. A narrow limit is useful, but the job may still hold broad production credentials. If the command is edited, retried with a different limit, or run from the wrong branch, the authority is still present. Approval, secret release, inventory access, and network access need to match the intended boundary.

They break when configuration is invisible. A changed `ansible.cfg`, a different `ANSIBLE_CONFIG`, or altered host key checking can change behavior across control nodes. Record the Ansible version and configuration path so the run can be explained later.

They also break during cleanup. A failed job can stop after writing `.vault-pass-prod` and before removing it. Cleanup should run after both success and failure, and workspaces that held secrets should not be reused casually.

## Putting It All Together

The orders deployment boundary is made from several pieces. The protected deployment runner is the control node. `inventories/prod.ini` is the production map. The SSH key, become permission, and `prod` Vault password source make that map usable. Approval releases those pieces to the job. `--limit` starts with one host. `serial` controls the rollout batch when the limit later widens. Artifacts show the version, config, inventory, selected hosts, recap, and health result.

That is the operating model for Ansible automation. Playbooks describe work. Execution boundaries decide who can aim that work at real systems, which systems are in reach, how quickly the run moves, and what evidence remains afterward.

---

**References**

- [ansible-playbook command line reference](https://docs.ansible.com/ansible/latest/cli/ansible-playbook.html)
- [How to build your inventory](https://docs.ansible.com/ansible/latest/inventory_guide/intro_inventory.html)
- [Managing vault passwords](https://docs.ansible.com/ansible/latest/vault_guide/vault_managing_passwords.html)
- [Using encrypted variables and files](https://docs.ansible.com/ansible/latest/vault_guide/vault_using_encrypted_content.html)
- [Ansible configuration settings](https://docs.ansible.com/ansible/latest/reference_appendices/config.html)
- [Controlling playbook execution: strategies and more](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_strategies.html)
- [Logging Ansible output](https://docs.ansible.com/ansible/latest/reference_appendices/logging.html)
