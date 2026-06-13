---
title: "Facts and Conditionals"
description: "Use Ansible facts and conditions to choose tasks based on what a host really is."
overview: "Facts are values Ansible gathers from a host. Conditions use those values to decide whether a task should run."
tags: ["ansible", "facts", "conditionals"]
order: 3
id: article-infrastructure-as-code-ansible-facts-conditionals
---

## Table of Contents

1. [Observed Host Data](#observed-host-data)
2. [Gathering and Inspecting Facts](#gathering-and-inspecting-facts)
3. [Using when Conditions](#using-when-conditions)
4. [Facts and Intent Variables](#facts-and-intent-variables)
5. [A Mixed Linux Fleet Example](#a-mixed-linux-fleet-example)
6. [Defensive Conditions](#defensive-conditions)
7. [Verification, Failure Reading, and Rollback](#verification-failure-reading-and-rollback)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## Observed Host Data
<!-- section-summary: Facts are values Ansible observes from a host, while conditionals use those values to decide which tasks apply. -->

**Facts** are values Ansible gathers from managed hosts. They can describe the operating system, distribution version, CPU architecture, memory, network interfaces, mount points, service manager, Python interpreter, and many other host details.

**Conditionals** are expressions that decide whether a task should run for a host. In Ansible, the most common conditional keyword is `when`. Each host evaluates the condition with its own variables and facts, so one task can run on Ubuntu hosts and skip Rocky Linux hosts in the same play.

The orders platform now has a mixed fleet. Older web servers run Ubuntu. Newer web servers run Rocky Linux. The team wants the same playbook to install the orders API on both groups, and the package manager and service prerequisites differ. Facts let the playbook observe each host before choosing the right task.

## Gathering and Inspecting Facts
<!-- section-summary: Fact gathering usually happens at the start of a play, and the setup module can inspect facts directly during troubleshooting. -->

Most plays gather facts at the beginning of the play unless `gather_facts: false` is set. Ansible runs fact-gathering logic, commonly through the `ansible.builtin.setup` module, and stores the data under `ansible_facts` plus several commonly used variables.

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  gather_facts: true
  tasks:
    - name: Show operating system family during troubleshooting
      ansible.builtin.debug:
        var: ansible_facts.os_family
      tags:
        - debug-facts
```

An ad hoc setup command is useful when you want to inspect one host before editing a playbook. It shows the values Ansible can use in later conditions.

```bash
ansible -i inventories/staging/hosts.yml orders-web-01.staging.example.com -m ansible.builtin.setup
```

The full fact output can be large. Filters help when you only need one family of facts, such as distribution or service-manager data.

```bash
ansible -i inventories/staging/hosts.yml orders-web-01.staging.example.com -m ansible.builtin.setup -a 'filter=ansible_distribution*'
ansible -i inventories/staging/hosts.yml orders-web-01.staging.example.com -m ansible.builtin.setup -a 'filter=ansible_service_mgr'
```

Fact gathering has a cost because Ansible connects to each host and collects data. A play that only calls an API from the control node may set `gather_facts: false`. A play that branches by operating system, network interface, or service manager should gather facts or provide a deliberate replacement value.

The stored data is a dictionary. The filtered output may include values like this:

```yaml
ansible_facts:
  distribution: Ubuntu
  distribution_major_version: "22"
  os_family: Debian
  service_mgr: systemd
```

When `gather_facts: false` is used for speed, the playbook should avoid fact-based conditions or gather the specific value another way. For example, a control-node-only API play can skip facts safely. A mixed Linux package play should gather facts, load OS-specific variables from inventory, or fail early when the expected OS value is missing.

## Using when Conditions
<!-- section-summary: The when keyword lets a task run only when an expression is true for the current host. -->

The `when` keyword uses a raw Jinja2 expression, so the condition appears without `{{ }}` wrappers. Ansible evaluates the expression for each host before it decides whether the task applies.

```yaml
- name: Install orders API on Debian family hosts
  ansible.builtin.apt:
    name: orders-api
    state: present
    update_cache: true
  when: ansible_facts.os_family == "Debian"

- name: Install orders API on Red Hat family hosts
  ansible.builtin.dnf:
    name: orders-api
    state: present
  when: ansible_facts.os_family == "RedHat"
```

On Ubuntu, the first task runs and the second task skips. On Rocky Linux, the second task runs and the first task skips. The output should show `skipping` for the irrelevant branch on each host.

Conditions can also combine several requirements. For example, TLS setup might run only when the environment enables TLS and the host has the expected certificate path.

```yaml
- name: Render TLS listener config
  ansible.builtin.template:
    src: orders-api-tls.yml.j2
    dest: "{{ orders_api_config_dir }}/tls.yml"
    mode: "0640"
  when:
    - orders_api_enable_tls | default(false) | bool
    - orders_api_certificate_path is defined
```

A list of conditions behaves like a logical `and`. Every condition in the list must be true for the task to run. This reads well during review because each requirement gets its own line.

## Facts and Intent Variables
<!-- section-summary: Facts describe what the host is, while intent variables describe what the team wants to configure. -->

Facts and variables both become values Ansible can use, and they should carry different meaning. A fact describes what Ansible observed on the host. An intent variable describes what the team wants for that host or environment.

For the orders platform, `ansible_facts.os_family` tells the playbook whether the host belongs to the Debian or Red Hat family. That should come from the host. `orders_api_public_name` tells the playbook which public hostname to render. That should come from inventory or another human-owned configuration source.

This distinction keeps automation honest. If inventory says `orders_os_family: Debian`, a rebuilt host can drift away from that label and still receive Debian-only tasks. If facts say the host is Debian, the playbook reacts to the machine it actually reached.

The opposite mistake also causes trouble. Facts are a poor source for business intent. A host's private IP address is a weak way to decide whether it belongs to production billing, staging checkout, or a feature preview. Inventory and deployment metadata should carry those decisions because people need to review and change them deliberately.

## A Mixed Linux Fleet Example
<!-- section-summary: Facts let one playbook support mixed operating systems while variables keep the service intent consistent. -->

Now connect the pieces in a production-style play. The orders team wants one playbook for both Ubuntu and Rocky Linux hosts. Package installation depends on facts. Service config depends on variables. Unsupported operating systems should fail early with a clear message.

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  gather_facts: true
  tasks:
    - name: Stop when the operating system family is unsupported
      ansible.builtin.fail:
        msg: "orders API role supports Debian and RedHat families, found {{ ansible_facts.os_family }}"
      when: ansible_facts.os_family not in ["Debian", "RedHat"]

    - name: Install orders API on Debian family hosts
      ansible.builtin.apt:
        name: orders-api
        state: present
        update_cache: true
      when: ansible_facts.os_family == "Debian"

    - name: Install orders API on Red Hat family hosts
      ansible.builtin.dnf:
        name: orders-api
        state: present
      when: ansible_facts.os_family == "RedHat"

    - name: Render shared orders API config
      ansible.builtin.template:
        src: orders-api.yml.j2
        dest: "{{ orders_api_config_dir }}/config.yml"
        mode: "0640"
      notify: Restart orders API
```

The package tasks branch by facts. The shared template task uses variables such as `orders_api_config_dir`, `orders_api_public_name`, and `orders_api_database_host`. That separation lets the same service intent run across a mixed fleet.

The early `fail` task is important. If a new Amazon Linux host accidentally enters the `orders_web` group and the role lacks test coverage there, the playbook stops with a message that explains the missing support. Silent skipping would make the host look successful while leaving the service unconfigured.

## Defensive Conditions
<!-- section-summary: Defensive conditions handle missing facts, optional variables, skipped tasks, and type conversions without accidental failures. -->

Conditions should handle missing values and mixed host data. Some facts may be absent on minimal systems. Some variables may be optional. Some registered results may exist only on hosts where an earlier task ran.

The `default` filter is useful for optional booleans. It gives the condition a safe value when inventory leaves the flag unset.

```yaml
- name: Enable verbose API logging for selected hosts
  ansible.builtin.template:
    src: verbose-logging.yml.j2
    dest: "{{ orders_api_config_dir }}/logging.yml"
    mode: "0640"
  when: orders_api_verbose_logging | default(false) | bool
```

Type conversion matters for numeric comparisons. Facts may arrive as strings depending on the source. If the playbook compares a major version, convert it before comparing.

```yaml
- name: Apply Rocky 9 service override
  ansible.builtin.template:
    src: orders-api-systemd-override.conf.j2
    dest: /etc/systemd/system/orders-api.service.d/override.conf
    mode: "0644"
  when:
    - ansible_facts.distribution == "Rocky"
    - ansible_facts.distribution_major_version | int >= 9
```

Registered results need the same care. If a previous task ran only on Debian hosts, later tasks should check that the result exists and ran normally before reading deep fields.

```yaml
- name: Restart after Debian repository refresh succeeded
  ansible.builtin.service:
    name: orders-api
    state: restarted
  when:
    - apt_refresh is defined
    - not apt_refresh.skipped | default(false)
    - apt_refresh.rc | default(0) == 0
```

The goal is readable safety. A condition should explain why a task applies. If the condition becomes long or repeated, move shared decisions into a well-named variable or role task rather than copying complex expressions across the playbook.

## Verification, Failure Reading, and Rollback
<!-- section-summary: Fact-driven playbooks should be tested against representative hosts so skips, failures, and unsupported branches are visible before production. -->

Verification starts with representative hosts. A mixed fleet playbook should run against at least one Debian-family host and one Red Hat-family host in staging. That proves both package branches run and the shared service tasks still work.

```bash
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit orders-web-ubuntu-01.staging.example.com --check --diff
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit orders-web-rocky-01.staging.example.com --check --diff
```

Output reading should match the expected branch. On Ubuntu, the `apt` task should run and the `dnf` task should skip. On Rocky Linux, the `dnf` task should run and the `apt` task should skip. If both package tasks skip, the fact value or condition needs attention.

Common failures usually point to a small set of causes. If a task says a fact is undefined, the play may have `gather_facts: false` or the host may lack that fact. If a condition compares a version incorrectly, convert the value with `| int`. If an unsupported host silently skips key tasks, add an early `fail` task so the output shows the missing setup clearly.

Rollback for fact-driven changes is usually a normal playbook rollback. If a new condition routed Rocky hosts to the wrong template, revert the condition or template change in Git and run the playbook against a Rocky canary. If the wrong hosts entered an inventory group, fix inventory first, confirm with `--list-hosts`, then rerun the playbook for the affected hosts.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders_web --list-hosts
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-rocky-01.example.com
```

Fact caching, if enabled in an environment, adds one more thing to check. Cached facts can make a playbook use old host data after a rebuild. In that setup, teams should know how their controller or configuration refreshes facts before relying on OS or network facts for production branching.

## Putting It All Together
<!-- section-summary: Facts and conditions let one playbook adapt to real host differences while keeping environment intent in reviewed variables. -->

The orders platform now uses facts for host reality and variables for team intent. Facts choose the package manager and operating-system-specific tasks. Variables provide public names, database hosts, health paths, release values, and feature flags. Conditions connect those values to tasks in a way each host can evaluate for itself.

The playbook is safer because unsupported systems fail early, optional features use defaults, numeric comparisons use type conversion, and mixed fleet behavior is tested on representative hosts. The output should show the branch each host took, which gives operators a clean way to verify the run.

The next article uses task output as live data. Facts describe the host before tasks run. Registered results describe what a specific task observed during the run.

## What's Next

The next article covers registered task results. It follows validation commands, HTTP health checks, and return codes so the playbook can reload, fail, or roll back based on evidence from the current run.

---

**References**

- [Discovering variables: facts and magic variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_vars_facts.html) - Official guide to facts, magic variables, fact gathering, and using host data.
- [ansible.builtin.setup](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/setup_module.html) - Official module reference for gathering and filtering facts from managed hosts.
- [Conditionals](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_conditionals.html) - Official guide to `when`, facts in conditions, variables in conditions, registered variables, and common fact usage.
- [Using variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html) - Official guide to variable syntax, variable sources, and how variables are referenced in playbooks.
- [ansible.builtin.set_fact](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/set_fact_module.html) - Official module reference for creating host variables during a playbook run.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for limits, listing hosts, check mode, diff mode, and playbook execution.
