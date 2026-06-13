---
title: "Dynamic and Static Reuse"
description: "Choose imports, includes, and collections when Ansible reuse needs the right timing and source."
overview: "Ansible has several reuse tools. The main difference between imports and includes is when Ansible loads them."
tags: ["ansible", "imports", "includes", "collections"]
order: 2
id: article-infrastructure-as-code-ansible-includes-imports-collections
---

## Table of Contents

1. [Reuse Also Has Timing](#reuse-also-has-timing)
2. [Static Imports](#static-imports)
3. [Dynamic Includes](#dynamic-includes)
4. [Tags, Loops, and Task Listing](#tags-loops-and-task-listing)
5. [Roles in Static or Dynamic Form](#roles-in-static-or-dynamic-form)
6. [Collections as Versioned Packages](#collections-as-versioned-packages)
7. [Verification and CI](#verification-and-ci)
8. [Upgrade and Rollback Safety](#upgrade-and-rollback-safety)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Reuse Also Has Timing
<!-- section-summary: Imports are loaded before execution, while includes are chosen during execution. -->

Roles give service automation a home. The next question is timing: should Ansible load the reused content while it parses the playbook, or should it decide during the run after it knows facts, variables, loop items, and earlier task results?

Ansible has two reuse families for that choice. **Imports** are static. Ansible preprocesses imported tasks, roles, or playbooks before normal task execution. **Includes** are dynamic. Ansible reaches an include as a task during execution and then loads the selected tasks, variables, or role.

Here is the timing in plain order:

1. Parse the playbook.
2. Expand imports.
3. List static tasks.
4. Start the run.
5. Reach the include task.
6. Load dynamic content for that host.

That timing affects what operators can see before the run. Static content is easier to list ahead of time. Dynamic content is more flexible because the current host, loop item, or earlier result can choose the file or role.

The orders platform now has a reusable `orders_api` role, plus a few smaller task files for operating-system setup and service checks. Some of that content should always be part of the playbook. Some content depends on each host. That is where imports and includes start to matter.

## Static Imports
<!-- section-summary: Static imports make reused content visible to Ansible before the run starts. -->

A **static import** loads reused content while Ansible builds the playbook. Common tools are `ansible.builtin.import_tasks`, `ansible.builtin.import_role`, and `import_playbook`. Static imports fit content that forms part of the fixed playbook shape.

For the orders web fleet, every host needs the common package setup and the same core role:

```yaml
- name: Import common Linux baseline tasks
  ansible.builtin.import_tasks: common-linux-baseline.yml

- name: Import orders API role
  ansible.builtin.import_role:
    name: orders_api
```

The advantage is visibility. `ansible-playbook --list-tasks` can show imported tasks because Ansible already expanded them. Syntax checks and tag listing also have more information before the run touches a host.

Static imports work well for predictable structure. If every orders web host always needs the same baseline, the import tells reviewers exactly what belongs to the play. Conditions on imports apply across imported content, so the condition should describe a broad, structural choice instead of a tiny runtime branch.

## Dynamic Includes
<!-- section-summary: Dynamic includes let the current host, loop item, or runtime result choose reused content. -->

A **dynamic include** loads reused content when the playbook reaches that include task during execution. Common tools are `ansible.builtin.include_tasks`, `ansible.builtin.include_role`, and `include_vars`. Dynamic includes fit choices that depend on host facts, loop items, or earlier task results.

The orders fleet has both Ubuntu and Red Hat family hosts during a migration. Package names and service helpers differ by OS family, so the playbook can choose a task file per host. The file names stay plain so operators can inspect every possible branch:

```yaml
- name: Include OS-specific package tasks
  ansible.builtin.include_tasks: "packages-{{ ansible_facts.os_family | lower }}.yml"
```

An Ubuntu host can include `packages-debian.yml`, while a Rocky Linux host can include `packages-redhat.yml`. The selected file depends on facts gathered for that host, so a dynamic include fits the job.

Dynamic includes are also useful with loops. If the platform team wants to run the same validation role for several local service endpoints, `include_role` can run once per loop item with a clear loop variable.

```yaml
- name: Run endpoint checks for local orders services
  ansible.builtin.include_role:
    name: service_endpoint_check
  loop:
    - name: orders-api
      url: http://127.0.0.1:8080/ready
    - name: nginx
      url: http://127.0.0.1/nginx-health
  loop_control:
    loop_var: endpoint_check
```

## Tags, Loops, and Task Listing
<!-- section-summary: The timing choice changes what operators can list, tag, loop over, and start from. -->

The import/include choice shows up in everyday commands. Static imports are expanded before execution, so `--list-tasks` and `--list-tags` can show the imported work. Dynamic includes appear first as include tasks, and the inner tasks become known when the include runs.

```bash
ansible-playbook -i inventories/staging orders-web.yml --list-tasks
ansible-playbook -i inventories/staging orders-web.yml --list-tags
```

That matters during review. If `common-linux-baseline.yml` is imported, an operator can list the exact tasks before the run. If `packages-{{ ansible_facts.os_family | lower }}.yml` is included, the operator should inspect the possible files and understand which fact chooses them.

Loops are another major difference. Includes can run in loops because the include itself is a task. Imports are expanded during parsing, so they are a poor fit for per-item runtime work. When you need one role execution per generated item, `include_role` usually fits the job.

Tags also need deliberate design with dynamic includes. A tag on the include controls whether the include task runs. The tasks inside the included file need matching tags, or the include should use `apply` to pass tags to inner tasks.

```yaml
- name: Include orders health checks with health tags
  ansible.builtin.include_tasks:
    file: health-checks.yml
    apply:
      tags:
        - orders_health
  tags:
    - orders_health
```

This pattern helps emergency commands behave as expected:

```bash
ansible-playbook -i inventories/production orders-web.yml --tags orders_health --limit orders-web-prod-01
```

## Roles in Static or Dynamic Form
<!-- section-summary: Play-level roles and import_role fit fixed structure, while include_role fits runtime choices. -->

Roles can be used three common ways. A play-level `roles` list adds the role as part of the fixed play structure. `import_role` brings a role into a task list statically. `include_role` loads and executes a role dynamically during the run.

For the normal orders web deployment, a play-level role is straightforward:

```yaml
- name: Configure orders web servers
  hosts: orders_web
  become: true
  serial: 1
  roles:
    - role: orders_api
```

For a fixed task-list location, `import_role` keeps the role visible early:

```yaml
- name: Import the orders API role after preflight checks
  ansible.builtin.import_role:
    name: orders_api
```

For runtime choices, `include_role` gives more flexibility. A canary play might include a rollback role only after a health check result indicates a failed deployment on that host.

```yaml
- name: Include rollback role for failed canary host
  ansible.builtin.include_role:
    name: orders_api_rollback
  when: canary_health.status is defined and canary_health.status != 200
```

The practical question is: **should this role be part of the fixed play structure, or should the current host decide during execution?** Fixed structure points to play-level roles or `import_role`. Runtime decisions, loops, and host-specific selection point to `include_role`.

## Collections as Versioned Packages
<!-- section-summary: Collections package roles, modules, plugins, and docs under a namespace so teams can share tested automation. -->

A **collection** is Ansible's package format for roles, modules, plugins, playbooks, documentation, and tests. Collections live under a namespace and name, such as `community.general` or an internal collection like `devpolaris.platform`. They let teams share automation with versions instead of copying role directories between repositories.

The orders platform might use community modules for system helpers and an internal collection for company service roles:

```yaml
collections:
  - name: community.general
    version: "==11.4.0"
  - name: devpolaris.platform
    version: "==2.3.1"
```

Install them in CI and on automation runners before running playbooks:

```bash
ansible-galaxy collection install -r collections/requirements.yml
ansible-galaxy collection list
```

Version pinning matters because a collection can change module behavior, role defaults, or plugin code. Production automation should run with a reviewed dependency set. A collection upgrade should look like any other infrastructure change: update the version, run syntax checks and staging tests, review diffs, then promote.

## Verification and CI
<!-- section-summary: Reuse choices should be verified with syntax checks, task listing, tag listing, staging runs, and pinned dependencies. -->

Verification starts with installing the same collection versions that production will use. CI should install from `collections/requirements.yml`, run syntax checks, and list tasks for playbooks where static imports should be visible.

```bash
ansible-galaxy collection install -r collections/requirements.yml
ansible-playbook -i inventories/staging orders-web.yml --syntax-check
ansible-playbook -i inventories/staging orders-web.yml --list-tasks
ansible-playbook -i inventories/staging orders-web.yml --list-tags
```

For dynamic includes, CI should also check the files that facts or variables can select. If the playbook includes `packages-{{ ansible_facts.os_family | lower }}.yml`, reviewers should see `packages-debian.yml` and `packages-redhat.yml` in the same change when the include logic changes.

Run staging with the same tags and limits operators will use in production:

```bash
ansible-playbook -i inventories/staging orders-web.yml --limit orders-web-stg-01 --check --diff
ansible-playbook -i inventories/staging orders-web.yml --tags orders_health --limit orders-web-stg-01
```

This catches two common problems early. A dynamic include may select a missing file for one OS family. A tag-limited run may execute the include task and leave out the inner work when tags are missing from the included tasks.

## Upgrade and Rollback Safety
<!-- section-summary: Reused content can affect many playbooks, so upgrades need pinning, staging, and a clear revert path. -->

Reusable content has a wider blast radius than a one-off task. A role used by ten playbooks can change ten workflows. A collection upgrade can change modules and plugins across the whole automation repository. That power is useful, and it deserves a careful release path.

For internal roles, review role changes with the playbooks that call them. For collections, pin exact versions in requirements, commit the requirement change, and run staging before production. Keep the previous requirement version in Git so rollback is a normal revert.

```bash
git diff collections/requirements.yml
ansible-galaxy collection install -r collections/requirements.yml --force
ansible-playbook -i inventories/staging orders-web.yml --limit orders-web-stg-01 --check --diff
```

If an upgraded collection or shared role breaks production, revert the requirements or role commit, reinstall dependencies, and rerun the playbook through the same production limit. That gives you a clean path back to the last reviewed dependency set.

```bash
git revert <collection-or-role-upgrade-commit>
ansible-galaxy collection install -r collections/requirements.yml --force
ansible-playbook -i inventories/production orders-web.yml --limit orders-web-prod-01 --diff
```

## Putting It All Together
<!-- section-summary: Reusable Ansible content uses imports for fixed structure, includes for runtime choices, roles for service boundaries, and collections for sharing. -->

The orders automation now has several reuse layers. The `orders_api` role packages service setup. Static imports bring fixed baseline tasks into the playbook early so operators can list them. Dynamic includes choose OS-specific task files from host facts. Collections provide versioned shared modules and roles for the team.

The operator workflow matches those choices. CI installs pinned collections, runs syntax checks, lists tasks and tags, and tests staging. Production runs use limits and serial batches. If a reused dependency causes trouble, Git rollback and dependency reinstall bring the playbook back to the previous reviewed state.

Reusable Ansible content needs three habits: make the common path clear to read, make runtime choices explicit, and keep shared dependencies versioned. With those habits in place, a small playbook can support a growing fleet without hiding its behavior.

## What's Next

The next group covers secrets and safety. Reusable automation eventually needs passwords, tokens, private keys, and certificates. The next article starts with Ansible Vault and explains where encrypted values become plain text during a run.

---

**References**

- [Reusing Ansible artifacts](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse.html) - Official guide for imports, includes, reusable files, roles, and handler reuse behavior.
- [Roles](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse_roles.html) - Official guide for play-level roles, `include_role`, `import_role`, and role argument validation.
- [ansible.builtin.include_role](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/include_role_module.html) - Official module documentation for dynamically loading and executing roles.
- [ansible.builtin.import_role](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/import_role_module.html) - Official module documentation for statically importing roles.
- [Using Ansible collections](https://docs.ansible.com/projects/ansible/latest/collections_guide/index.html) - Official guide for collection structure and usage.
- [Ansible Galaxy user guide](https://docs.ansible.com/projects/ansible/latest/galaxy/user_guide.html) - Official guide for installing roles and collections from requirements files.
