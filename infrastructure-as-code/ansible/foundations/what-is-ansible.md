---
title: "What Is Ansible"
description: "Understand what Ansible is, what problem it solves, and how it changes machines without a permanent agent."
overview: "Ansible is an automation tool for configuring machines and running repeatable operations before the roadmap moves into inventories and safer run workflows."
tags: ["ansible", "configuration", "modules", "idempotency"]
order: 1
id: article-cloud-iac-infrastructure-as-code-config-mgmt-ansible
aliases:
  - config-mgmt-ansible
  - infrastructure-as-code/ansible/config-mgmt-ansible.md
  - cloud-iac/infrastructure-as-code/config-mgmt-ansible.md
  - child-infrastructure-as-code-config-mgmt-ansible
---

## Table of Contents

1. [Why Teams Reach for Ansible](#why-teams-reach-for-ansible)
2. [The Two Sides of a Run](#the-two-sides-of-a-run)
3. [Inventory: The Host Map](#inventory-the-host-map)
4. [Playbooks, Plays, and Tasks](#playbooks-plays-and-tasks)
5. [Modules and Idempotency](#modules-and-idempotency)
6. [Variables, Templates, and Handlers](#variables-templates-and-handlers)
7. [What Actually Happens During Execution](#what-actually-happens-during-execution)
8. [Production Runbooks and Safety](#production-runbooks-and-safety)
9. [Common Failure Signals](#common-failure-signals)
10. [Where Ansible Fits](#where-ansible-fits)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)
13. [References](#references)

## Why Teams Reach for Ansible
<!-- section-summary: Ansible turns repeated server work into reviewed files that the team can run the same way again. -->

**Ansible** is an automation tool for configuring machines, deploying applications, and running repeatable operations across a fleet. The useful beginner definition is this: Ansible connects to target systems, runs small pieces of automation, and reports what changed. For most Linux server work, it uses SSH and normal privilege escalation instead of asking every server to run a permanent Ansible service.

Picture a small production orders platform. The team has `web-01` and `web-02` running Nginx and an `orders-api` systemd service, plus `worker-01` processing background jobs. At the start, an engineer can SSH into one machine, install a package, edit a config file, and restart a service by hand. That feels fast until the same change has to land on three machines, then staging, then the new hosts added next month.

The first map is simple. **Inventory** names the machines. **Playbooks** describe the work. **Modules** do the actual package, file, service, user, command, and API operations. **Variables** carry environment values into the same playbook. **Handlers** connect file changes to service reloads. **Run output** tells the team what changed, what stayed already correct, and where the run failed. The rest of the article walks through those pieces in that order so the later workflow articles have a clear base.

Manual server work has a very simple failure pattern. One host gets the timeout update and another one keeps the old value. Someone restarts the service before checking the Nginx syntax. A production fix lives in shell history on one laptop instead of a reviewed repository. Ansible gives the team a shared path where the package install, config template, service reload, and verification commands live in files.

The important shift is **repeatability**. The team can review a pull request, run the playbook in staging, run the same playbook against one production host, and then widen the rollout. A new server joins the fleet by entering inventory and receiving the same tasks as the other servers. The work moves from private terminal memory into version-controlled operations.

## The Two Sides of a Run
<!-- section-summary: Ansible runs on a control node and reaches managed nodes through connection plugins such as SSH. -->

Every Ansible run has two sides. The **control node** is the machine that runs Ansible. It can be an engineer's laptop, a bastion host, a CI runner, or Red Hat Ansible Automation Platform. The **managed nodes** are the machines, network devices, cloud endpoints, or other targets that Ansible manages.

For the orders platform, a GitHub Actions runner or an automation controller execution node might be the control node during a release. The managed nodes are `web-01`, `web-02`, and `worker-01`. The control node reads the automation repository, opens connections to those hosts, sends module work, collects results, and closes or reuses the connection.

This architecture explains the word **agentless** as people use it with Ansible. In the common Linux path, Ansible reaches servers over SSH and runs work there for the duration of the task. The server needs a reachable connection path, a usable remote user, enough privilege for the requested change, and usually a Python interpreter for many Linux modules.

The same idea can reach other systems through different connection plugins and modules. Windows hosts often use WinRM or other Windows-focused paths. Network devices may use network-specific connection plugins. Cloud modules can call provider APIs from the control node. The beginner path starts with Linux over SSH because it shows the shape clearly.

That control-node detail matters in production. If the run happens from a laptop, the laptop needs the SSH key, Ansible version, collections, and network path. If the run happens from CI, the CI runner becomes the control node and its workspace, secrets, and outbound network rules decide what the playbook can see. If the run happens from Automation Platform, the job template, credentials, inventory, and execution environment become the reviewed launch boundary.

## Inventory: The Host Map
<!-- section-summary: Inventory tells Ansible which systems exist, how to reach them, and which groups they belong to. -->

**Inventory** is Ansible's host map. It names machines, groups them, and stores connection details or host-specific variables. A good inventory lets the playbook say "configure the web group" while each environment decides which actual hosts belong to that group.

For the orders platform, staging and production can share the same playbook while using different inventories. The production inventory might say `web-01` connects to `10.20.1.11`, while staging might say `web-stg-01` connects to `10.30.1.11`. The automation name stays stable inside Ansible even when the IP address or DNS name changes.

```yaml
all:
  children:
    web:
      hosts:
        web-01:
          ansible_host: 10.20.1.11
        web-02:
          ansible_host: 10.20.1.12
    workers:
      hosts:
        worker-01:
          ansible_host: 10.20.1.21
  vars:
    ansible_user: deploy
    ansible_python_interpreter: /usr/bin/python3
```

The group names become safety boundaries. A playbook can target `web` for Nginx tasks and `workers` for background job tasks. Runtime commands can also narrow the target set with `--limit web-01`, which matters when the first production run should touch one host only.

Production inventories often grow beyond one file. Teams split `inventories/staging` and `inventories/prod`, keep group variables under `group_vars/`, and use dynamic inventory when cloud hosts come and go. The key habit stays the same: inventory owns the host map, and playbooks own the work.

## Playbooks, Plays, and Tasks
<!-- section-summary: Playbooks describe ordered work, plays choose host groups, and tasks call modules. -->

A **playbook** is the YAML file that describes the automation run. It contains one or more **plays**. A play chooses hosts from inventory and then runs a list of **tasks** for those hosts. Each task usually calls one Ansible module with arguments.

Here is a small playbook for the orders web servers. It installs Nginx, renders the site config, and keeps the service running. The `become: true` line tells Ansible to use privilege escalation because package, config, and service changes usually need root-level permissions on Linux.

```yaml
- name: Configure orders web servers
  hosts: web
  become: true
  tasks:
    - name: Install Nginx
      ansible.builtin.package:
        name: nginx
        state: present

    - name: Render orders Nginx config
      ansible.builtin.template:
        src: orders-api.conf.j2
        dest: /etc/nginx/conf.d/orders-api.conf
        owner: root
        group: root
        mode: "0644"

    - name: Keep Nginx enabled and running
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: true
```

The fully qualified module names, such as `ansible.builtin.package`, make the playbook clearer because Ansible collections can contain modules with the same short name. A **collection** is a packaged set of modules, plugins, roles, and documentation. The built-in collection ships with common modules for files, packages, services, commands, users, templates, and many other day-to-day tasks.

The playbook reads top to bottom. Ansible applies each task to the hosts matched by the play, records a result for each host, and then moves to the next task. That ordered behavior makes Ansible useful for configuration and release steps where one action prepares the next one.

## Modules and Idempotency
<!-- section-summary: Modules are the task tools, and many modules compare current state with requested state before changing anything. -->

A **module** is the piece of Ansible code that performs one kind of work. The package module manages packages, the template module renders files from Jinja2 templates, the service module manages services, and the user module manages local accounts. Modules give Ansible structured behavior instead of leaving every task as a custom shell command.

The major Ansible habit is **idempotency**. In plain terms, an idempotent task can run again and settle on the same final state. If Nginx is already installed, `state: present` reports `ok`. If the rendered config already matches the template output, the template task reports `ok`. If the file differs, the task reports `changed`.

That status matters in production because it separates real changes from confirmation. A first run might install a package and render a file. A second run against the same host should usually return mostly `ok`. When the same task reports `changed` on every run, the playbook may contain unstable template data, a custom command without a clear change condition, or a module argument that asks for a fresh change every time.

Some tasks still need command-style work. For example, an application migration command might have to run during a release. In that case, the playbook should make the behavior explicit with guards such as `creates`, `removes`, `changed_when`, or a small verification query. That keeps the run readable for the next engineer who has to decide whether the output is healthy.

```yaml
- name: Run orders database migration once for this release
  ansible.builtin.command:
    cmd: /opt/orders-api/bin/migrate --version 2026.06.13
    creates: /var/lib/orders-api/migrations/2026.06.13.done
```

This task says the migration command creates a marker file. When the marker exists, Ansible can skip the command. The task becomes safer because the playbook names the condition that makes the operation already complete.

## Variables, Templates, and Handlers
<!-- section-summary: Variables keep environment differences out of task logic, templates render config, and handlers react only when notified. -->

Real fleets need different values in each environment. Production might use `orders.internal.example.com`, four worker processes, and a 45 second upstream timeout. Staging might use a staging hostname and a shorter timeout. **Variables** keep those values outside the core task flow so the playbook can stay reusable.

```yaml
orders_api_upstream: "http://127.0.0.1:8080"
orders_api_server_name: "orders.example.com"
orders_api_proxy_timeout: "45s"
```

A **template** is a file with variables inside it. Ansible uses Jinja2 to render the template into a real config file on the managed host. The Nginx template for the orders API might look like this:

```nginx
server {
  listen 80;
  server_name {{ orders_api_server_name }};

  location / {
    proxy_pass {{ orders_api_upstream }};
    proxy_read_timeout {{ orders_api_proxy_timeout }};
  }
}
```

The template task becomes powerful when it pairs with a **handler**. A handler is a task that runs only after another task notifies it, and it runs once per play even if several tasks notify it. That gives the team a clean pattern for service reloads: render the config, notify the reload handler only if the file changed, and keep quiet when the config already matches.

```yaml
- name: Configure orders web servers
  hosts: web
  become: true
  tasks:
    - name: Render orders Nginx config
      ansible.builtin.template:
        src: orders-api.conf.j2
        dest: /etc/nginx/conf.d/orders-api.conf
        mode: "0644"
      notify: Reload Nginx

  handlers:
    - name: Reload Nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
```

This is the production shape teams want for config files. The file change is reviewable in Git, the rendered result can show up in diff mode, and the service reload happens only when the input changed. That gives the deployment output a clear story instead of restarting services on every run.

## What Actually Happens During Execution
<!-- section-summary: A run loads config and inventory, connects to hosts, executes modules, and returns structured per-host results. -->

When `ansible-playbook` runs, Ansible loads configuration, inventory, variables, roles, collections, and the playbook. It resolves the host pattern, opens connections, gathers facts if the play asks for them, and runs tasks in order. **Facts** are discovered details about a managed node, such as operating system family, IP addresses, CPU details, and memory.

For many Linux modules, Ansible prepares module code on the control node, sends it to the managed node, runs it with a remote interpreter, and reads structured output. Interpreter discovery usually finds Python for supported Linux targets, and inventory can pin `ansible_python_interpreter` when an image uses a specific path. That under-the-hood detail explains why a host can accept SSH but still fail an Ansible task when Python, temporary directories, or sudo rules are locked down.

The output categories have different meanings. `ok` means the task completed and reported no change. `changed` means the task modified something or the module reported a change. `failed` means Ansible reached the host and the task logic failed. `unreachable` means the connection path or remote execution setup broke before the task could run normally.

That distinction helps during a release. If `web-02` is unreachable, the team investigates SSH, host keys, bastion routing, firewall rules, DNS, or the remote user. If `web-02` is failed on the Nginx reload task, the team reads the module message, checks `nginx -t`, and looks at the rendered config. The same recap tells different stories depending on the result class.

## Production Runbooks and Safety
<!-- section-summary: Production Ansible work usually uses review, preview, canary runs, verification, and a rollback path. -->

Production Ansible work works best as a planned runbook. The orders team can keep the playbook, templates, variables, and role files in Git. A pull request shows the Nginx timeout change, CI runs syntax checks and linting, staging receives the run first, and production receives a small canary before the full web group.

The practical command sequence might look like this:

```bash
ansible-inventory -i inventories/prod --graph web
ansible -i inventories/prod web -m ansible.builtin.ping
ansible -i inventories/prod web -b -m ansible.builtin.command -a whoami
ansible-playbook -i inventories/prod site.yml --syntax-check
ansible-playbook -i inventories/prod site.yml --limit web-01 --check --diff
ansible-playbook -i inventories/prod site.yml --limit web-01 --diff
```

Each command answers one question. Inventory inspection confirms the target set. The ping module confirms Ansible can connect and run a module. The `whoami` command with `-b` confirms privilege escalation. Syntax check catches YAML and playbook shape problems. Check mode and diff mode show supported planned changes. The limited real run proves the behavior on one host.

Verification should live near the runbook. After the canary run, the team might query the app and the service directly. These checks make the service result visible instead of relying only on the play recap:

```bash
curl -fsS https://orders.example.com/health
ansible -i inventories/prod web-01 -b -m ansible.builtin.command -a "systemctl is-active nginx"
ansible -i inventories/prod web-01 -b -m ansible.builtin.command -a "nginx -t"
```

Rollback needs the same concrete shape. For a bad config change, the team can revert the Git commit, rerun the playbook against the affected host, verify `nginx -t`, and reload the service through the handler. For a bad package update, the safer playbook may pin a previous package version or deploy the previous application artifact. For a host that broke outside Ansible, a narrow repair play with `--limit web-01` keeps the recovery focused.

## Common Failure Signals
<!-- section-summary: Ansible failure output usually points to target selection, connection, privilege, interpreter, module, or idempotency problems. -->

Beginners often see a red run and read it as one big failure. Ansible output gives more useful clues than that. The first question is which layer failed: inventory selection, network connection, authentication, privilege escalation, interpreter setup, module logic, service validation, or application verification.

`unreachable` usually points to the connection layer. The host may have the wrong `ansible_host`, the SSH key may be missing from the control node, the host key may have changed, the bastion path may be closed, or the remote user may be wrong. A quick `ansible -i inventories/prod web-02 -m ansible.builtin.ping -vvv` gives more connection detail when the normal output is too thin.

Privilege failures usually show messages around sudo, passwords, or permission denied errors on protected paths. The playbook can set `become: true`, inventory can provide `ansible_become_user`, and the operating system must allow the remote user to perform the requested privileged work. In production, teams usually prefer a dedicated deploy user with narrowly documented sudo rules instead of personal accounts running random administrative commands.

Module failures usually carry the useful message inside the task result. A template task might fail because a variable is undefined. A service task might fail because the service name differs between operating systems. A package task might fail because another package manager process holds a lock. The fix starts by reading the module message, checking the specific host, and rerunning with a narrow limit after the playbook or host problem is corrected.

Idempotency failures show up as repeated `changed` results. A template that embeds the current timestamp will change every run. A command task without `creates`, `removes`, or `changed_when` may report a change every time. Those failures make CI and production evidence noisy, so experienced teams clean them up early.

## Where Ansible Fits
<!-- section-summary: Ansible fits configuration, deployment, orchestration, repair, and platform automation after resources exist. -->

Ansible fits best where a team needs repeatable operations across existing systems. It can configure packages and services after Terraform creates servers, deploy application config, rotate certificates, manage local users, coordinate load balancer steps, patch a fleet, collect diagnostics, and run one-off repair jobs in a controlled way. It also works well for network automation and for some API-driven platform tasks when good modules exist.

Infrastructure tools often overlap, so the useful boundary is the job each tool owns. Terraform usually fits long-lived cloud resource provisioning because it keeps a state file and plans resource graph changes. Ansible usually fits operating-system configuration, application deployment steps, and procedural orchestration where the run order and remote host behavior matter. Many production teams use both: Terraform creates the VM, security group, load balancer, and DNS record; Ansible configures the OS and deploys the service.

In the orders platform, Terraform might create an autoscaling group, load balancer, security groups, and DNS name. Ansible can then install Nginx, render `/etc/nginx/conf.d/orders-api.conf`, place the systemd drop-in, reload the service, and call the health endpoint. That split gives each tool a clear job. Terraform owns the cloud resources, while Ansible owns the host configuration and the ordered service steps.

Red Hat Ansible Automation Platform adds production controls around this same Ansible content. Job templates bundle a playbook, inventory, credentials, execution environment, and runtime options so teams can launch approved automation repeatedly. Execution environments package the Ansible runtime, Python dependencies, and collections into container images, which helps CI and controller runs behave the same way.

The small team version can still be simple. A repository with `site.yml`, `roles/orders_web`, `inventories/staging`, and `inventories/prod` gives the team a clean start. The important habit is treating automation as production code: review changes, test them in staging, limit first production runs, keep secrets out of plain variables, and verify after the run.

## Putting It All Together
<!-- section-summary: Ansible combines inventory, playbooks, modules, variables, handlers, and run evidence into repeatable operations. -->

Here is the whole picture for the orders platform. Inventory names `web-01`, `web-02`, and `worker-01`, groups them by role, and stores connection details. A playbook selects `web`, uses modules to install Nginx, renders a template from environment variables, and notifies a handler to reload Nginx only when the config changed.

During the run, the control node loads the repository, connects to each managed node, sends module work, and receives structured results. The output tells the team whether each host was already correct, changed, failed, or unreachable. A second run should settle, which gives the team confidence that the playbook describes state rather than a pile of one-time shell steps.

Production value comes from shared evidence more than speed. The target set is inspectable, the config is reviewable, the preview is visible, the canary is narrow, the verification is written down, and rollback uses the same automation path. A three-server team benefits from that discipline because the next incident has a record instead of a memory of what someone typed.

## What's Next

Now the pieces have names: control node, managed node, inventory, playbook, module, variable, template, handler, idempotency, and recap. The next article turns those pieces into an operating sequence. It follows one production change from inventory inspection through connection tests, preview, canary apply, verification, recap reading, rerun, and rollback.

That workflow keeps production work controlled. Ansible can change many hosts, while the operator chooses the order, evidence, and blast radius.

---

**References**

- [Ansible playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html) - Defines playbooks, plays, tasks, module calls, playbook execution, idempotency, check mode, and syntax verification.
- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html) - Explains inventory files, host groups, variables, and inventory organization.
- [Ansible builtin collection](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/index.html) - Lists common built-in modules used for packages, files, templates, services, commands, and users.
- [Interpreter Discovery](https://docs.ansible.com/projects/ansible/latest/reference_appendices/interpreter_discovery.html) - Documents how Ansible discovers Python interpreters on managed nodes.
- [Understanding privilege escalation: become](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_privilege_escalation.html) - Explains how Ansible uses existing privilege escalation systems such as sudo.
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Documents handlers and notification behavior for change-driven operations.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Covers preview behavior, diff output, and module support limits.
- [Red Hat Ansible Automation Platform job templates](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/controller-job-templates) - Describes job templates as reusable definitions for running Ansible jobs with inventory, credentials, and other parameters.
- [Red Hat Ansible Automation Platform execution environments](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/assembly-controller-execution-environments) - Describes containerized execution environments for Ansible runtime dependencies and collections.
