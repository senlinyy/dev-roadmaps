---
title: "Facts and Conditionals"
description: "Use Ansible facts and conditions to choose tasks based on what a host really is."
overview: "Facts are values Ansible gathers from a host. Conditions use those values to decide whether a task should run."
tags: ["ansible", "facts", "conditionals"]
order: 3
id: article-infrastructure-as-code-ansible-facts-conditionals
---

## Table of Contents

1. [What Are Facts and Why Do Conditions Need Them?](#what-are-facts-and-why-do-conditions-need-them)
2. [How Does Ansible Gather and Inspect Facts?](#how-does-ansible-gather-and-inspect-facts)
3. [How Does a when Condition Decide Whether to Run?](#how-does-a-when-condition-decide-whether-to-run)
4. [How Should Facts and Intent Variables Work Together?](#how-should-facts-and-intent-variables-work-together)
5. [How Can One Play Support a Mixed Linux Fleet?](#how-can-one-play-support-a-mixed-linux-fleet)
6. [How Do You Write Defensive Conditions?](#how-do-you-write-defensive-conditions)
7. [When Should You Use Results, setfact, or Loops?](#when-should-you-use-results-setfact-or-loops)
8. [How Do You Verify and Maintain Conditional Automation?](#how-do-you-verify-and-maintain-conditional-automation)
9. [Check Your Answers](#check-your-answers)

**Facts** are values Ansible gathers from managed hosts. They can describe the operating system, distribution version, CPU architecture, memory, network interfaces, mount points, service manager, Python interpreter, and many other host details.

**Conditionals** are expressions that decide whether a task should run for a host. In Ansible, the most common conditional keyword is `when`. Each host evaluates the condition with its own variables and facts, so one task can run on Ubuntu hosts and skip Rocky Linux hosts in the same play.

The application platform now has a mixed fleet. Older web servers run Ubuntu. Newer web servers run Rocky Linux. The team wants the same playbook to install the application API on both groups, and the package manager and service prerequisites differ. Facts let the playbook observe each host before choosing the right task.

That problem has two inputs. Inventory expresses which hosts should receive the application, while facts reveal how each reached host is built. The playbook combines both inputs and chooses concrete work for each host.

Keep these questions in view as you work through the lesson:

1. **What Are Facts and Why Do Conditions Need Them?**
2. **How Does Ansible Gather and Inspect Facts?**
3. **How Does a when Condition Decide Whether to Run?**
4. **How Should Facts and Intent Variables Work Together?**
5. **How Can One Play Support a Mixed Linux Fleet?**
6. **How Do You Write Defensive Conditions?**
7. **When Should You Use Results, set_fact, or Loops?**
8. **How Do You Verify and Maintain Conditional Automation?**

## What Are Facts and Why Do Conditions Need Them?
<!-- section-summary: Facts are values Ansible observes from a host, while conditionals use those values to decide which tasks apply. -->

```text
desired membership + observed machine state → condition → run or skip
```

A fact is an observation, not a promise. `ansible_facts['distribution']` may report `Ubuntu` because Ansible inspected the current machine. It does not mean the machine must remain Ubuntu forever. If the host is rebuilt as Rocky Linux, newly gathered facts should change even if its inventory name remains the same.

Facts are also snapshots. They describe the host when they were gathered. If a task later creates an interface, changes a hostname, or adds storage, the old fact data does not automatically refresh. Gather the relevant facts again when later decisions must use the changed state.

## How Does Ansible Gather and Inspect Facts?
<!-- section-summary: Fact gathering usually happens at the start of a play, and the setup module can inspect facts directly during troubleshooting. -->

Most plays gather facts at the beginning of the play unless `gather_facts: false` is set. Ansible runs fact-gathering logic, commonly through the `ansible.builtin.setup` module, and stores the structured data under `ansible_facts` plus several commonly used variables.


![Fact Gathering Map](/content-assets/articles/article-infrastructure-as-code-ansible-facts-conditionals/fact-gathering-map.png)

*The fact map shows Ansible collecting host evidence such as OS family, IP address, memory, and distribution before choosing work.*

```yaml
- name: Configure application web hosts
  hosts: application_web
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
ansible -i inventories/staging/hosts.yml application-web-01.staging.example.com -m ansible.builtin.setup
```

The full fact output can be large. Filters help when you only need one family of facts, such as distribution or service-manager data.

```bash
ansible -i inventories/staging/hosts.yml application-web-01.staging.example.com -m ansible.builtin.setup -a 'filter=ansible_distribution*'
ansible -i inventories/staging/hosts.yml application-web-01.staging.example.com -m ansible.builtin.setup -a 'filter=ansible_service_mgr'
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

Disabling fact gathering is therefore a dependency decision, not a general performance switch. Ask which later tasks depend on `ansible_facts` before turning it off. A play can also call `ansible.builtin.setup` explicitly when facts are needed only after an earlier phase, or use a narrow fact filter when only a subset matters.

## How Does a when Condition Decide Whether to Run?
<!-- section-summary: The when keyword lets a task run only when an expression is true for the current host. -->

The `when` keyword uses a raw Jinja2 expression, so the condition appears without `{{ }}` wrappers. Ansible evaluates the expression for each host before it decides whether the task applies.


![When Condition Flow](/content-assets/articles/article-infrastructure-as-code-ansible-facts-conditionals/when-condition-flow.png)

*The condition flow shows facts and intent variables feeding a when decision so only the matching task runs.*

```yaml
- name: Install application API on Debian family hosts
  ansible.builtin.apt:
    name: application-api
    state: present
    update_cache: true
  when: ansible_facts.os_family == "Debian"

- name: Install application API on Red Hat family hosts
  ansible.builtin.dnf:
    name: application-api
    state: present
  when: ansible_facts.os_family == "RedHat"
```

On Ubuntu, the first task runs and the second task skips. On Rocky Linux, the second task runs and the first task skips. The output should show `skipping` for the irrelevant branch on each host.

Conditions can also combine several requirements. For example, TLS setup might run only when the environment enables TLS and the host has the expected certificate path.

```yaml
- name: Render TLS listener config
  ansible.builtin.template:
    src: application-api-tls.yml.j2
    dest: "{{ application_api_config_dir }}/tls.yml"
    mode: "0640"
  when:
    - application_api_enable_tls | default(false) | bool
    - application_api_certificate_path is defined
```

A list of conditions behaves like a logical `and`. Every condition in the list must be true for the task to run. This reads well during review because each requirement gets its own line.

The missing braces are intentional. Module strings often use `{{ value }}` because Jinja must render part of a YAML value. A `when` clause is already evaluated as an expression, so adding braces produces a warning and obscures the actual comparison.

Use `or` when any one acceptable state should allow the task:

```yaml
- name: Install a systemd unit on supported families
  ansible.builtin.template:
    src: application-api.service.j2
    dest: /etc/systemd/system/application-api.service
    mode: "0644"
  when: ansible_facts.os_family == "Debian" or ansible_facts.os_family == "RedHat"
```

Types matter inside expressions. The text value `"10"` and number `10` are not interchangeable in every comparison, and the string `"false"` is not the same as YAML boolean `false`. Convert values at the decision boundary with filters such as `| int` and `| bool` when their source may not provide the expected type.

## How Should Facts and Intent Variables Work Together?
<!-- section-summary: Facts describe what the host is, while intent variables describe what the team wants to configure. -->

Facts and variables both become values Ansible can use, and they should carry different meaning. A fact describes what Ansible observed on the host. An intent variable describes what the team wants for that host or environment.

For the application platform, `ansible_facts.os_family` tells the playbook whether the host belongs to the Debian or Red Hat family. That should come from the host. `application_api_public_name` tells the playbook which public hostname to render. That should come from inventory or another human-owned configuration source.

This distinction keeps automation honest. If inventory says `application_os_family: Debian`, a rebuilt host can drift away from that label and still receive Debian-only tasks. If facts say the host is Debian, the playbook reacts to the machine it actually reached.

The opposite mistake also causes trouble. Facts are a poor source for business intent. A host's private IP address is a weak way to decide whether it belongs to production, staging, or a temporary preview environment. Reviewed inventory and deployment metadata should carry those decisions because people need to review and change them deliberately.

Prefer capability facts over distribution labels when the capability is what the task actually needs. If the question is “does this host use systemd?”, `ansible_facts.service_mgr == "systemd"` expresses the dependency more directly than a growing list of distributions that usually use systemd. Distribution branches remain appropriate for truly distribution-specific package names or repositories.

A practical decision hierarchy keeps the model clear:

```text
only a value differs             → use a variable
machine behavior truly differs  → use an observed fact
desired policy differs          → use inventory intent
something was learned in a task → use a registered result
runtime value must be derived    → use set_fact
mandatory precondition is false → fail clearly
```

## How Can One Play Support a Mixed Linux Fleet?
<!-- section-summary: Facts let one playbook support mixed operating systems while variables keep the service intent consistent. -->

Now connect the pieces in a production-style play. The application team wants one playbook for both Ubuntu and Rocky Linux hosts. Package installation depends on facts. Service config depends on variables. Unsupported operating systems should fail early with a clear message.

```yaml
- name: Configure application web hosts
  hosts: application_web
  become: true
  gather_facts: true
  tasks:
    - name: Stop when the operating system family is unsupported
      ansible.builtin.fail:
        msg: "application API role supports Debian and RedHat families, found {{ ansible_facts.os_family }}"
      when: ansible_facts.os_family not in ["Debian", "RedHat"]

    - name: Install application API on Debian family hosts
      ansible.builtin.apt:
        name: application-api
        state: present
        update_cache: true
      when: ansible_facts.os_family == "Debian"

    - name: Install application API on Red Hat family hosts
      ansible.builtin.dnf:
        name: application-api
        state: present
      when: ansible_facts.os_family == "RedHat"

    - name: Render shared application API config
      ansible.builtin.template:
        src: application-api.yml.j2
        dest: "{{ application_api_config_dir }}/config.yml"
        mode: "0640"
      notify: Restart application API
```

The package tasks branch by facts. The shared template task uses variables such as `application_api_config_dir`, `application_api_public_name`, and `application_api_database_host`. That separation lets the same service intent run across a mixed fleet.

The early `fail` task is important. If a new Amazon Linux host accidentally enters the `application_web` group and the role lacks test coverage there, the playbook stops with a message that explains the missing support. Silent skipping would make the host look successful while leaving the service unconfigured.

## How Do You Write Defensive Conditions?
<!-- section-summary: Defensive conditions handle missing facts, optional variables, skipped tasks, and type conversions without accidental failures. -->

Conditions should handle missing values and mixed host data. Some facts may be absent on minimal systems. Some variables may be optional. Some registered results may exist only on hosts where an earlier task ran.

The `default` filter is useful for optional booleans. It gives the condition a safe value when inventory leaves the flag unset.

```yaml
- name: Enable verbose API logging for selected hosts
  ansible.builtin.template:
    src: verbose-logging.yml.j2
    dest: "{{ application_api_config_dir }}/logging.yml"
    mode: "0640"
  when: application_api_verbose_logging | default(false) | bool
```

Type conversion matters for numeric comparisons. Facts may arrive as strings depending on the source. If the playbook compares a major version, convert it before comparing.

```yaml
- name: Apply Rocky 9 service override
  ansible.builtin.template:
    src: application-api-systemd-override.conf.j2
    dest: /etc/systemd/system/application-api.service.d/override.conf
    mode: "0644"
  when:
    - ansible_facts.distribution == "Rocky"
    - ansible_facts.distribution_major_version | int >= 9
```

Registered results need the same care. If a previous task ran only on Debian hosts, later tasks should check that the result exists and ran normally before reading deep fields.

```yaml
- name: Restart after Debian repository refresh succeeded
  ansible.builtin.service:
    name: application-api
    state: restarted
  when:
    - apt_refresh is defined
    - not apt_refresh.skipped | default(false)
    - apt_refresh.rc | default(0) == 0
```

The goal is readable safety. A condition should explain why a task applies. If the condition grows long or appears in several places, move shared decisions into a well-named variable or role task rather than copying complex expressions across the playbook.

Defensive access matters when a dictionary field may be missing. Check the parent value or supply a safe default before walking deeper into it. A skip is appropriate for an optional feature; it is not appropriate when the missing value means the host cannot be configured correctly. In that case, use `ansible.builtin.assert` or `ansible.builtin.fail` so the operator sees the violated precondition.

Do not use `when` to recreate idempotency that a module already provides. For example, checking whether a package exists and then calling the package module adds another observation and a race. `ansible.builtin.package` already compares current and desired state. Conditions should select genuinely different behavior, not duplicate a module's convergence logic.

Likewise, avoid encoding organizational policy as machine detection. An IP prefix, hostname substring, or CPU count should not silently decide that a host is production. Put human-owned policy in groups and variables. Use facts for real machine capabilities, such as package family, service manager, or architecture.

## When Should You Use Results, set_fact, or Loops?
<!-- section-summary: Runtime observations and derived values extend conditions beyond the facts gathered at the start of a play. -->

Facts are not the only observations a condition can consume. A task can register its result and let a later task respond to what just happened:

```yaml
- name: Check the application health endpoint
  ansible.builtin.uri:
    url: "http://127.0.0.1:{{ application_api_port }}/health"
    return_content: true
  register: application_health
  changed_when: false
  failed_when: false

- name: Stop when the endpoint is unhealthy
  ansible.builtin.fail:
    msg: "Application health check returned {{ application_health.status | default('no status') }}"
  when: application_health.status | default(0) != 200
```

Facts describe the host when fact gathering ran; registered results describe one task's outcome during the current run. Registered result objects also support status tests such as `is succeeded`, `is failed`, `is changed`, and `is skipped`. Those tests communicate intent more clearly than reconstructing every state from low-level fields.

`set_fact` is slightly misleadingly named because it creates a variable for the current host during execution; it does not necessarily discover a hardware or operating-system fact. Use it when several later tasks need the same derived decision:

```yaml
- name: Choose the package module family
  ansible.builtin.set_fact:
    application_package_family: "{{ 'apt' if ansible_facts.os_family == 'Debian' else 'dnf' }}"
```

Conditions are evaluated at execution time for each host. If an earlier task changes or registers a value, a later `when` can see that value. In a loop, Ansible evaluates the condition for every item, so the item becomes another input:

```yaml
- name: Install enabled optional packages
  ansible.builtin.package:
    name: "{{ item.name }}"
    state: present
  loop: "{{ application_optional_packages }}"
  when: item.enabled | default(false) | bool
```

This permits precise selection, but complicated loop conditions often signal that the input data should be filtered or structured more clearly.

## How Do You Verify and Maintain Conditional Automation?
<!-- section-summary: Fact-driven playbooks should be tested against representative hosts so skips, failures, and unsupported branches are visible before production. -->

Verification starts with representative hosts. A mixed fleet playbook should run against at least one Debian-family host and one Red Hat-family host in staging. That proves both package branches run and the shared service tasks still work.

```bash
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit application-web-ubuntu-01.staging.example.com --check --diff
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit application-web-rocky-01.staging.example.com --check --diff
```

Output reading should match the expected branch. On Ubuntu, the `apt` task should run and the `dnf` task should skip. On Rocky Linux, the `dnf` task should run and the `apt` task should skip. If both package tasks skip, the fact value or condition needs attention.

The same check can inspect facts directly. This is useful when the playbook branch looks wrong and the team needs to confirm what Ansible gathered from the host.

```bash
ansible -i inventories/staging/hosts.yml application-web-rocky-01.staging.example.com \
  -m ansible.builtin.setup \
  -a 'filter=ansible_os_family'
```

Common failures usually point to a small set of causes. If a task says a fact is undefined, the play may have `gather_facts: false` or the host may lack that fact. If a condition compares a version incorrectly, convert the value with `| int`. If an unsupported host silently skips key tasks, add an early `fail` task so the output shows the missing setup clearly.

Rollback for fact-driven changes is usually a normal playbook rollback. If a new condition routed Rocky hosts to the wrong template, revert the condition or template change in Git and run the playbook against a Rocky canary. If the wrong hosts entered an inventory group, fix inventory first, confirm with `--list-hosts`, then rerun the playbook for the affected hosts.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application_web --list-hosts
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application-web-rocky-01.example.com
```

Fact caching, if enabled in an environment, adds one more thing to check. Cached facts can make a playbook use old host data after a rebuild. In that setup, teams should know how their controller or configuration refreshes facts before relying on OS or network facts for production branching.

The application platform now uses facts for host reality and variables for team intent. Facts choose the package manager and operating-system-specific tasks. Variables provide public names, database hosts, health paths, release values, and feature flags. Conditions connect those values to tasks in a way each host can evaluate for itself.


![Facts Summary](/content-assets/articles/article-infrastructure-as-code-ansible-facts-conditionals/facts-summary.png)

*The summary follows the conditional path: observe, decide, skip safely, verify, and roll back.*

The playbook is safer because unsupported systems fail early, optional features use defaults, numeric comparisons use type conversion, and mixed fleet behavior is tested on representative hosts. The output should show the branch each host took, which gives operators a clean way to verify the run.

One final maintenance rule is to keep the decision tree smaller than the task logic. If every task repeats a long test for distribution, version, environment, feature flag, and previous result, reviewers can no longer see the desired state. Load an operating-system-specific task file for genuinely different implementations, derive one clearly named runtime decision when several tasks share it, or move environment policy back to inventory. The condition should explain the boundary, while the selected tasks explain the work.

When a branch behaves unexpectedly, trace the inputs in order. Confirm the play gathered facts, inspect the exact fact value and type, inspect the processed inventory intent, then inspect any registered result or derived variable used later. Finally, read the task output for `skipping`, `changed`, and `failed`. This avoids changing a condition to match an assumption when the real problem is stale facts, unexpected inventory membership, or a string value that looked like a boolean.

The complete first-principles flow is:

```text
inventory selects the host and desired policy
                    +
facts describe the reached machine
                    +
earlier tasks provide runtime evidence
                    ↓
             evaluate condition
              /             \
           true             false
            ↓                 ↓
        run task           skip task
            ↓
      module converges state
```

This model also clarifies the architectural boundary. Inventory should remain reviewable human intent. Fact gathering is observation. `when` is routing. Modules still own convergence and idempotency after a branch has selected them. Mixing those responsibilities—such as inferring production from an address or checking file existence before using the file module—makes the automation harder to reason about and more vulnerable to drift.

Choose failure rather than a silent skip when the skipped work would leave a host unusable. An optional metrics agent may legitimately skip when a feature flag is false. A required package task should not quietly skip because `os_family` is missing or unsupported. An early assertion turns that ambiguity into an actionable run failure. Conversely, do not fail just because an optional fact is absent when a safe default makes the feature inapplicable. The distinction is operational: skipping means the resulting host is still acceptable; failing means Ansible cannot establish the promised desired state. Making that distinction explicit keeps a green play recap from hiding incomplete configuration.

The next article uses task output as live data. Facts describe the host before tasks run. Registered results describe what a specific task observed during the run, including validation commands, HTTP health checks, and return codes.

Custom facts extend the same observation model, but their producer and refresh lifecycle must be explicit. A locally stored fact can become stale policy if another system changes the machine without updating it. Prefer direct capability observation when possible and validate custom-fact provenance before routing critical work.

`gather_facts: true` collects the normal host snapshot before tasks, while explicit modules add narrower evidence later. `ansible.builtin.stat` can inspect a path, `ansible.builtin.command` can run a read-only probe with truthful change reporting, and `ansible.builtin.copy` can act on the resulting condition. Time facts such as `ansible_date_time` are also snapshots from fact gathering; do not treat them as a continuously advancing clock during a long play.

## Check Your Answers

:::expand[What Are Facts and Why Do Conditions Need Them?]{kind="recap"}
Facts are snapshots of observed host state. Conditions combine those observations with desired membership and decide, per host, whether a task runs or skips.
:::

:::expand[How Does Ansible Gather and Inspect Facts?]{kind="recap"}
Ansible normally gathers facts at play start through `setup`. Disable gathering only when later tasks do not depend on those values, and inspect filtered facts when troubleshooting.
:::

:::expand[How Does a when Condition Decide Whether to Run?]{kind="recap"}
`when` is already an expression context. Lists mean `and`, expressions can use `or`, and source values should be converted when boolean or numeric types matter.
:::

:::expand[How Should Facts and Intent Variables Work Together?]{kind="recap"}
Facts describe machine reality; inventory variables describe human-owned intent. Prefer capability facts when the needed capability is more precise than a distribution name.
:::

:::expand[How Can One Play Support a Mixed Linux Fleet?]{kind="recap"}
Branch only the operating-system-specific work, keep shared application intent in variables, and fail early when a host family is unsupported.
:::

:::expand[How Do You Write Defensive Conditions?]{kind="recap"}
Use defaults, type conversion, defined checks, and explicit failures. Do not use conditions to recreate module idempotency or infer organizational policy from machine details.
:::

:::expand[When Should You Use Results, set_fact, or Loops?]{kind="recap"}
Registered results capture task evidence, `set_fact` stores derived runtime values, and loop conditions decide separately for each item. All are evaluated in the current host context.
:::

:::expand[How Do You Verify and Maintain Conditional Automation?]{kind="recap"}
Test every supported branch on representative hosts, read expected skips, inspect facts directly, fail unsupported states, and account for stale cached facts after rebuilds.
:::

---

**References**

- [Discovering variables: facts and magic variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_vars_facts.html) - Official guide to facts, magic variables, fact gathering, and using host data.
- [ansible.builtin.setup](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/setup_module.html) - Official module reference for gathering and filtering facts from managed hosts.
- [Conditionals](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_conditionals.html) - Official guide to `when`, facts in conditions, variables in conditions, registered variables, and common fact usage.
- [Using variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html) - Official guide to variable syntax, variable sources, and how variables are referenced in playbooks.
- [ansible.builtin.set_fact](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/set_fact_module.html) - Official module reference for creating host variables during a playbook run.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for limits, listing hosts, check mode, diff mode, and playbook execution.
