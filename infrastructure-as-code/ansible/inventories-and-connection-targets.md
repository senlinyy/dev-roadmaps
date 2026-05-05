---
title: "Inventories and Connection Targets"
description: "Build Ansible inventories that clearly define hosts, groups, connection settings, variables, and safe target patterns."
overview: "Inventories are the map Ansible uses before any playbook can change a server. This article teaches how to name hosts, group Linux VMs, set SSH details, use patterns and limits, and diagnose connection failures before touching production."
tags: ["inventory", "ssh", "groups", "variables", "become"]
order: 2
id: article-infrastructure-as-code-ansible-inventories-and-connection-targets
---

## Table of Contents

1. [Why Target Selection Matters](#why-target-selection-matters)
2. [Inventory Is Your Server Map](#inventory-is-your-server-map)
3. [Groups Describe Jobs, Not Just Names](#groups-describe-jobs-not-just-names)
4. [Hostnames, Aliases, and Connection Details](#hostnames-aliases-and-connection-details)
5. [Variables Belong Near the Scope They Describe](#variables-belong-near-the-scope-they-describe)
6. [Patterns, Limits, and Canary Runs](#patterns-limits-and-canary-runs)
7. [Proving the Connection Before Changing Anything](#proving-the-connection-before-changing-anything)
8. [Privilege and Remote Users](#privilege-and-remote-users)
9. [Inventory Layouts for Teams](#inventory-layouts-for-teams)
10. [Common Inventory Failures](#common-inventory-failures)

## Why Target Selection Matters

Before a playbook installs a package or restarts a service, Ansible has to answer a quieter question: which machines are you talking about? That question deserves careful attention because the same playbook can be harmless on one test VM and risky on every production web server.

An inventory is Ansible's list of managed nodes, which are the machines Ansible can automate. The inventory can be a static file, a directory of files, or a dynamic source that asks a platform what exists. In the beginner path, a static YAML or INI file is enough. It tells Ansible which hosts exist, which groups they belong to, and which connection settings or variables apply to them.

The inventory exists because server names and connection details should not be scattered across commands. If everyone types private IPs by hand, it is easy to target the wrong host, forget a staging machine, or run production changes from a stale note. A reviewed inventory gives the team one place to inspect the server map before any task runs.

Inventories fit between infrastructure provisioning and playbooks. Terraform or another provisioning tool may create Linux VMs. The inventory names those VMs for Ansible. The playbook then says what state those hosts should reach. If the inventory is wrong, the playbook can be correct and still touch the wrong target.

For this article, keep using `devpolaris-orders`. The service has two Linux web VMs running Nginx and systemd. Staging has two hosts, production has two hosts, and the team wants to run the same playbook in both environments with different targets and a few different variables.

```text
devpolaris-orders:
  staging web VMs:
    orders-stg-web-01
    orders-stg-web-02

  production web VMs:
    orders-prod-web-01
    orders-prod-web-02

  shared playbook:
    configure Nginx
    install systemd unit
    keep services running
```

This target map is the first safety control. It lets you ask clear questions before a run: am I targeting staging or production, one host or both hosts, web servers or all servers, and which SSH user will Ansible use?

## Inventory Is Your Server Map

The smallest useful inventory names hosts and groups them. YAML inventory is a friendly starting point because the structure is visible, especially once you have nested groups or variables.

```yaml
all:
  children:
    orders_staging:
      children:
        orders_staging_web:
          hosts:
            orders-stg-web-01:
              ansible_host: 10.30.10.11
            orders-stg-web-02:
              ansible_host: 10.30.10.12
    orders_production:
      children:
        orders_production_web:
          hosts:
            orders-prod-web-01:
              ansible_host: 10.40.10.21
            orders-prod-web-02:
              ansible_host: 10.40.10.22
```

Read this from the top down. `all` is the built-in parent group for every inventory host. Under it, staging and production are separate environment groups. Inside each environment, the web hosts have their own group. That gives the team several target choices without editing the playbook.

You can show the group shape with `ansible-inventory`:

```bash
$ ansible-inventory -i inventory.yml --graph
@all:
  |--@ungrouped:
  |--@orders_staging:
  |  |--@orders_staging_web:
  |  |  |--orders-stg-web-01
  |  |  |--orders-stg-web-02
  |--@orders_production:
  |  |--@orders_production_web:
  |  |  |--orders-prod-web-01
  |  |  |--orders-prod-web-02
```

This command does not connect to any server. It only proves that Ansible can parse the inventory source and sees the group tree you expect. Run it before you debug SSH. If the graph is wrong, fix the inventory first.

The same inventory can be written in INI format:

```ini
[orders_staging_web]
orders-stg-web-01 ansible_host=10.30.10.11
orders-stg-web-02 ansible_host=10.30.10.12

[orders_production_web]
orders-prod-web-01 ansible_host=10.40.10.21
orders-prod-web-02 ansible_host=10.40.10.22

[orders_staging:children]
orders_staging_web

[orders_production:children]
orders_production_web
```

INI is common in older examples and small teams. YAML is easier to extend once values become nested. Pick one format for a project and keep it consistent. Switching formats mid-module teaches teammates to think about syntax instead of target safety.

The inventory file should be boring to review. Hostnames should be clear, group names should reveal purpose, and addresses should be easy to compare with the cloud provider or VM list. If a reviewer cannot tell whether a host is staging or production from its name or group, the inventory is asking for mistakes.

## Groups Describe Jobs, Not Just Names

Groups are more than folders for hostnames. A group says "these machines share a job or a context." For `devpolaris-orders`, the web group means the machines receive HTTP traffic through Nginx and proxy to the local app. A future worker group might run background jobs, and a future database group might hold managed database clients or admin tools.

A useful grouping scheme usually separates environment from function:

```text
environment:
  orders_staging
  orders_production

function:
  orders_staging_web
  orders_production_web
  orders_staging_workers
  orders_production_workers
```

That shape lets the team ask two different questions. "Which environment?" is about risk and data. "Which function?" is about what the host does. Production web hosts have a different blast radius from staging workers.

You can also create parent groups that collect the same function across environments:

```yaml
all:
  children:
    orders_web:
      children:
        orders_staging_web:
        orders_production_web:
    orders_staging:
      children:
        orders_staging_web:
    orders_production:
      children:
        orders_production_web:
```

This pattern is useful, but use it carefully. A playbook with `hosts: orders_web` now targets both staging and production web hosts unless you add a limit. That may be correct for a read-only audit. It is rarely the first target for a config change.

Here is a safer playbook target for normal staging work:

```yaml
- name: Configure orders staging web servers
  hosts: orders_staging_web
  become: true
  tasks:
    - name: Keep nginx running
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: true
```

The `hosts` line should make the ordinary target obvious. Command-line limits can narrow the run, but the playbook itself should not depend on a human remembering to exclude production every time.

Group design has a tradeoff. Too few groups make every run depend on manual host lists. Too many groups create names nobody trusts. Start with environment and function groups, then add special groups only when a real workflow needs them.

| Group Style | Good Use | Risk |
|-------------|----------|------|
| `orders_staging_web` | Routine staging web changes | Needs matching prod group |
| `orders_production_web` | Explicit production web changes | Higher blast radius |
| `orders_web` | Read-only checks across all web hosts | Can mix environments |
| `canary` | Temporary first-host rollout | Easy to forget if maintained by hand |
| `legacy_nginx` | Migration work for known old hosts | Can become stale after migration |

Groups should age with the system. A temporary migration group should disappear after the migration. A permanent role group should stay accurate as hosts are added or removed.

## Hostnames, Aliases, and Connection Details

An inventory host name is the name Ansible uses in output, variables, and patterns. It does not have to be the DNS name or IP address used for the SSH connection. That separation is useful because humans need stable names and networks often use changing addresses.

```yaml
orders-prod-web-01:
  ansible_host: 10.40.10.21
  ansible_user: deploy
```

In this example, `orders-prod-web-01` is the inventory name. `10.40.10.21` is the connection address. `deploy` is the remote user Ansible uses for SSH. If the VM gets a new private IP after rebuild, the inventory alias can stay the same while `ansible_host` changes.

Connection settings can live on a host or a group. If every production web host uses the same SSH user, put that value at the group level:

```yaml
orders_production_web:
  hosts:
    orders-prod-web-01:
      ansible_host: 10.40.10.21
    orders-prod-web-02:
      ansible_host: 10.40.10.22
  vars:
    ansible_user: deploy
    ansible_ssh_private_key_file: ~/.ssh/devpolaris-orders-prod
```

That avoids repeating the same SSH user and key path on every host. It also gives reviewers one place to inspect the connection identity for that group.

The common behavioral connection variables are:

| Variable | Meaning | Example |
|----------|---------|---------|
| `ansible_host` | Real address to connect to | `10.40.10.21` |
| `ansible_user` | Remote SSH user | `deploy` |
| `ansible_port` | SSH port | `22` |
| `ansible_ssh_private_key_file` | Key file on the control node | `~/.ssh/devpolaris-orders-prod` |
| `ansible_connection` | Connection plugin | `ssh` or `local` |
| `ansible_become` | Whether to escalate privilege | `true` |
| `ansible_become_user` | User to become | `root` |

Do not put secret key contents or passwords in a plain inventory file. The inventory can point at a key path on the control node, but it should not contain private key material. When secrets are needed, use your team's secret manager or Ansible Vault once you reach that part of the roadmap.

You can inspect the fully merged view for one host:

```bash
$ ansible-inventory -i inventory.yml --host orders-prod-web-01
{
    "ansible_host": "10.40.10.21",
    "ansible_user": "deploy",
    "app_name": "devpolaris-orders",
    "orders_app_port": 3000,
    "orders_server_name": "orders.devpolaris.example"
}
```

This is one of the best beginner diagnostics. It answers "what does Ansible believe about this host?" before any SSH connection happens. If the remote user, app port, or server name is wrong here, the playbook will inherit that wrong value.

## Variables Belong Near the Scope They Describe

Inventory variables let you attach data to hosts and groups. The placement matters because variables are part of how a playbook becomes environment-specific without copying the whole playbook.

For `devpolaris-orders`, the Nginx template needs a server name and app port. The port might be the same everywhere. The server name is different between staging and production.

```yaml
all:
  vars:
    app_name: devpolaris-orders
    orders_app_port: 3000
  children:
    orders_staging_web:
      hosts:
        orders-stg-web-01:
          ansible_host: 10.30.10.11
      vars:
        orders_server_name: staging-orders.devpolaris.example
    orders_production_web:
      hosts:
        orders-prod-web-01:
          ansible_host: 10.40.10.21
      vars:
        orders_server_name: orders.devpolaris.example
```

The shared values live under `all.vars`. The environment-specific values live under the web group for that environment. That placement tells a reviewer why the value differs. It also prevents a production value from being pasted into a staging playbook by accident.

As inventories grow, many teams move variables into `group_vars` and `host_vars` files. The directory names are special. Ansible reads files under them and merges the values into matching groups or hosts.

```text
ansible/
  inventory.yml
  group_vars/
    all.yml
    orders_staging_web.yml
    orders_production_web.yml
  host_vars/
    orders-prod-web-01.yml
```

The same data becomes easier to review:

```yaml
app_name: devpolaris-orders
orders_app_port: 3000
```

```yaml
orders_server_name: orders.devpolaris.example
nginx_access_log: /var/log/nginx/orders.access.log
```

Use host variables for true host-specific values. A good example is a per-host drain priority, special disk path, or temporary migration flag. If every host in a group has the same value, putting it in every `host_vars` file creates copy-paste work and makes differences harder to see.

Variable scope has a tradeoff. Putting everything in one file is easy at first, but the file becomes crowded as environments grow. Splitting too early creates many tiny files. A practical beginner rule is to start in `inventory.yml`, then move to `group_vars` when the inventory file becomes hard to scan.

You should also be careful with variable names. A name like `port` is too vague because many services have ports. A name like `orders_app_port` is clearer. It tells the reader which application the value belongs to and reduces accidental collisions when the same host runs more than one service.

## Patterns, Limits, and Canary Runs

A pattern is the expression Ansible uses to select hosts from inventory. In a playbook, the `hosts:` value is a pattern. On the command line, ad hoc commands and `--limit` also use patterns.

The safest patterns are boring group names:

```yaml
- name: Configure production orders web servers
  hosts: orders_production_web
```

That targets the production web group and nothing else. The playbook is honest about its normal blast radius.

Ansible patterns can also combine, intersect, and exclude groups:

```text
orders_web
orders_staging_web
orders_production_web
orders_web:&orders_production
orders_web:!orders_prod_web_02
orders-stg-web-01,orders-stg-web-02
```

The intersection pattern `orders_web:&orders_production` means hosts that are in both groups. The exclusion pattern means the selected group except one host. These patterns are useful for operations, but they should not become a puzzle in daily playbooks.

For a canary run, prefer a clear `--limit`:

```bash
$ ansible-playbook -i inventory.yml playbooks/orders-web.yml --limit orders-prod-web-01
```

That command keeps the playbook target as production web hosts but narrows this specific run to one host. After verifying Nginx and application health on the canary, the team can run the same playbook without the limit.

Use `--list-hosts` when you are not certain what a pattern will select:

```bash
$ ansible-playbook -i inventory.yml playbooks/orders-web.yml --limit 'orders_web:&orders_production' --list-hosts

playbook: playbooks/orders-web.yml

  play #1 (orders_production_web): Configure production orders web servers
    pattern: ['orders_production_web']
    hosts (2):
      orders-prod-web-01
      orders-prod-web-02
```

The output shows the hosts before any task runs. This is useful in pull request testing and before production maintenance. It catches surprises like a stale host still sitting in a production group.

One warning belongs here: shell characters can change command-line patterns if you do not quote them. Exclusion uses `!`, and some shells treat `!` specially. Put complex limits in single quotes:

```bash
$ ansible-playbook -i inventory.yml playbooks/orders-web.yml --limit 'orders_production_web:!orders-prod-web-02'
```

The tradeoff with advanced patterns is readability. They are helpful when responding to a specific operational need, but long expressions are easy to misread. If a target pattern becomes part of a routine workflow, consider turning it into a named group.

## Proving the Connection Before Changing Anything

Inventory parsing and SSH connectivity are separate checks. The inventory graph can be perfect while SSH still fails. Prove both before running a playbook that changes state.

Start with the built-in ping module:

```bash
$ ansible orders_staging_web -i inventory.yml -m ansible.builtin.ping
orders-stg-web-01 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
orders-stg-web-02 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
```

The `ping` module is an Ansible module call, not network ICMP ping. A successful response means Ansible connected, transferred module code, ran it with the remote Python environment, and received a result.

If the remote user is wrong, the failure points at authentication:

```text
orders-prod-web-01 | UNREACHABLE! => {
    "changed": false,
    "msg": "Failed to connect to the host via ssh: deploy@10.40.10.21: Permission denied (publickey).",
    "unreachable": true
}
```

The first checks are practical: does the `deploy` user exist on the host, is the correct public key installed in `~deploy/.ssh/authorized_keys`, is the private key available on the control node, and did the inventory point to the right key file?

If the address is wrong or the network path is blocked, the message looks different:

```text
orders-prod-web-02 | UNREACHABLE! => {
    "changed": false,
    "msg": "Failed to connect to the host via ssh: ssh: connect to host 10.40.10.22 port 22: Connection timed out",
    "unreachable": true
}
```

That is not a password problem. It is a reachability problem. Check the VM private IP, route from the control node, security group or firewall rules, VPN access, and whether SSH is listening.

You can increase verbosity when the short message is not enough:

```bash
$ ansible orders_production_web -i inventory.yml -m ansible.builtin.ping -vvv
```

Verbose output can be long, so use it when needed rather than by default. The useful parts are the SSH command Ansible built, the key path it tried, the remote user, and the exact failure returned by SSH.

Connection checks are cheap compared with a failed production run. Make them part of the workflow whenever a new inventory, new host, new key, or new control node is introduced.

## Privilege and Remote Users

The remote user and the privileged user are different ideas. The remote user is the account used to connect over SSH. The privileged user is the account a task becomes when it needs more authority, usually `root` through sudo.

For `devpolaris-orders`, the inventory might say:

```yaml
orders_production_web:
  hosts:
    orders-prod-web-01:
      ansible_host: 10.40.10.21
  vars:
    ansible_user: deploy
    ansible_become: true
    ansible_become_user: root
```

This says Ansible connects as `deploy`, then escalates to `root` for tasks that need it. The playbook may also set `become: true` at the play level. When both inventory and playbook settings exist, Ansible's precedence rules decide which value wins, so keep the project convention clear.

The reason to avoid SSH directly as root is accountability and control. A normal deployment user can have a known key, a known sudo policy, and a narrower audit story. Direct root SSH removes that separation. Some environments disable root SSH entirely.

If sudo needs a password and the control node cannot provide it, you may see this:

```text
fatal: [orders-prod-web-01]: FAILED! => {
    "msg": "Missing sudo password"
}
```

For learning, you can pass `--ask-become-pass` and type the password when prompted:

```bash
$ ansible-playbook -i inventory.yml playbooks/orders-web.yml --ask-become-pass
```

In a team automation workflow, interactive prompts are usually a poor fit because CI cannot sit there typing. Teams normally use a controlled deployment identity with appropriate sudo rules, or an automation platform that handles credentials through approved secret storage.

Privilege settings belong in the place your team can review them clearly. If every task in a production server playbook needs root, `become: true` at the play level is readable. If only two tasks need root, putting `become: true` on those tasks tells a better story.

```yaml
- name: Read local health endpoint without root
  ansible.builtin.uri:
    url: http://127.0.0.1/health
    status_code: 200

- name: Reload nginx with root privileges
  become: true
  ansible.builtin.service:
    name: nginx
    state: reloaded
```

That split helps reviewers see which tasks carry system authority. Inventory supplies connection identity. Playbooks should still make privileged behavior visible near the work.

## Inventory Layouts for Teams

A single inventory file is fine for the first article. A team usually grows into a directory layout because staging, production, group variables, host variables, and dynamic sources need room.

One clear static layout is one inventory directory per environment:

```text
ansible/
  inventories/
    staging/
      hosts.yml
      group_vars/
        all.yml
        orders_web.yml
    production/
      hosts.yml
      group_vars/
        all.yml
        orders_web.yml
  playbooks/
    orders-web.yml
```

With this layout, the environment is selected by the inventory path:

```bash
$ ansible-playbook -i inventories/staging playbooks/orders-web.yml
$ ansible-playbook -i inventories/production playbooks/orders-web.yml --limit orders-prod-web-01
```

That makes accidental environment mixing less likely. A production run has the word `production` in the command. A staging run has the word `staging` in the command. The playbook can still use the same group name, such as `orders_web`, inside each environment inventory.

The `inventories/production/hosts.yml` file might look like this:

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-prod-web-01:
          ansible_host: 10.40.10.21
        orders-prod-web-02:
          ansible_host: 10.40.10.22
```

The matching production group vars can hold production-specific values:

```yaml
orders_server_name: orders.devpolaris.example
orders_app_port: 3000
nginx_access_log: /var/log/nginx/orders.access.log
```

Staging can keep the same group name with different values:

```yaml
orders_server_name: staging-orders.devpolaris.example
orders_app_port: 3000
nginx_access_log: /var/log/nginx/orders-staging.access.log
```

The tradeoff is duplication. Separate environment directories make target selection clear, but shared values may appear in more than one place. You can reduce duplication with shared group vars, roles, or generated inventory later. Do not solve that too early. Clear targets matter more than clever file reuse while the team is learning.

Dynamic inventory becomes useful when hosts are created and destroyed often. A dynamic inventory plugin can ask AWS, Azure, GCP, VMware, or another source which machines exist and group them by tags or metadata. That is helpful at scale, but the same mental model still applies: Ansible needs a host list, group names, variables, and connection details before a playbook can run.

For a first Ansible module, static inventory teaches the ideas better. You can see every host and every variable. Once that is comfortable, dynamic inventory is just another source for the same target map.

## Common Inventory Failures

Most inventory mistakes reveal themselves before the playbook changes anything. The trick is learning which layer the error belongs to.

The first common failure is no inventory parsed:

```text
[WARNING]: No inventory was parsed, only implicit localhost is available
[WARNING]: provided hosts list is empty, only localhost is available
```

This usually means the `-i` path is wrong, the file is not readable, or the inventory syntax is broken enough that Ansible ignored it. Run `ls` on the path, then run `ansible-inventory -i <path> --graph`. Do not debug SSH until Ansible can parse the inventory.

The second failure is a host pattern that matches nothing:

```text
[WARNING]: Could not match supplied host pattern, ignoring: orders_prod_web
ERROR! Specified inventory, host pattern and/or --limit leaves us with no hosts to target.
```

This is often a naming mismatch. The inventory has `orders_production_web`, but the playbook or command used `orders_prod_web`. The fix is to align the group name, not to edit task logic.

The third failure is a stale host:

```text
orders-prod-web-03 | UNREACHABLE! => {
    "changed": false,
    "msg": "Failed to connect to the host via ssh: Name or service not known",
    "unreachable": true
}
```

That host may have been removed from the cloud account, renamed, or left behind after a migration. Compare inventory with the VM source of truth and remove retired hosts through review. Stale inventory creates noise during incidents and can hide real failures.

The fourth failure is a variable at the wrong scope. For example, production suddenly renders the staging server name:

```text
server_name staging-orders.devpolaris.example;
```

Inspect the merged host variables:

```bash
$ ansible-inventory -i inventories/production --host orders-prod-web-01
```

If the wrong value appears there, the playbook is consuming what inventory gave it. Check `group_vars/all.yml`, environment group vars, host vars, and any extra variables passed on the command line.

The fifth failure is hidden production targeting. A playbook says `hosts: orders_web`, and the inventory group contains both staging and production. `--list-hosts` reveals the mistake:

```bash
$ ansible-playbook -i inventory.yml playbooks/orders-web.yml --list-hosts

hosts (4):
  orders-stg-web-01
  orders-stg-web-02
  orders-prod-web-01
  orders-prod-web-02
```

The fix direction is not only "remember to limit it." Change the ordinary target to an environment-specific group or split inventories by environment. The safest workflow is the one that makes the expected target the default.

Use this small checklist when an inventory run surprises you:

| Question | Command |
|----------|---------|
| Did Ansible parse the inventory? | `ansible-inventory -i inventory.yml --graph` |
| Which hosts will this playbook target? | `ansible-playbook -i inventory.yml playbook.yml --list-hosts` |
| What variables does one host receive? | `ansible-inventory -i inventory.yml --host orders-prod-web-01` |
| Can Ansible connect before changing state? | `ansible orders_production_web -i inventory.yml -m ansible.builtin.ping` |
| Is a canary limit in place? | `--limit orders-prod-web-01` |

Inventory work is careful naming and early proof. Once you can see the target map, connection identity, merged variables, and final host list, the playbook has a much safer place to run.

---

**References**

- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html) - Official inventory guide covering hosts, groups, variables, inventory formats, and inventory organization.
- [Patterns: targeting hosts and groups](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_patterns.html) - Official guide to patterns, limits, intersections, exclusions, and host selection behavior.
- [Connection methods and details](https://docs.ansible.com/projects/ansible/latest/inventory_guide/connection_details.html) - Official guide for SSH behavior, remote users, SSH keys, and connection settings.
- [Understanding privilege escalation: become](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_privilege_escalation.html) - Official guide to `become`, `become_user`, become variables, and privilege escalation limits.
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html) - Official reference for how configuration settings, command-line options, playbook keywords, variables, and direct assignment interact.
