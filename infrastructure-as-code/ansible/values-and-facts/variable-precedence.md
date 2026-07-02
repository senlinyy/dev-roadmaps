---
title: "Variable Precedence"
description: "Understand why Ansible chooses one variable value when the same name appears in multiple places."
overview: "Variable precedence is Ansible's conflict rule for values."
tags: ["ansible", "variables", "precedence"]
order: 2
id: article-infrastructure-as-code-ansible-variables-facts-precedence
aliases:
  - variables-facts-precedence
  - infrastructure-as-code/ansible/variables-facts-precedence.md
---

## Table of Contents

1. [When Values Collide](#when-values-collide)
2. [The Practical Precedence Shape](#the-practical-precedence-shape)
3. [Defaults, Environments, and Host Exceptions](#defaults-environments-and-host-exceptions)
4. [Extra Variables and Release Inputs](#extra-variables-and-release-inputs)
5. [Facts, Registered Results, and set_fact](#facts-registered-results-and-set_fact)
6. [Auditing the Winning Value](#auditing-the-winning-value)
7. [Common Precedence Failures and Rollback](#common-precedence-failures-and-rollback)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## When Values Collide
<!-- section-summary: Variable precedence is Ansible's rule system for selecting one value when several sources define the same variable. -->

**Variable precedence** is the order Ansible uses when the same variable name appears in more than one place. The final value has to be one value for one host during one task. Precedence is the rulebook Ansible follows to choose it.

Use the orders platform again. The role default says `orders_api_log_level: info`. Production inventory says `orders_api_log_level: warn`. A single host file says `orders_api_log_level: debug` during an incident. A release engineer passes `-e orders_api_log_level=error` during a special test. Ansible needs one final value for `orders-web-01` before it can render the config file.

This happens constantly in real playbooks. A value can come from role defaults, inventory groups, host variables, play variables, facts, registered results, `set_fact`, variable files, or extra variables. The goal is to place values where the winner feels obvious during review.

## The Practical Precedence Shape
<!-- section-summary: Ansible has broad precedence categories, and variables sit above many other control sources. -->

Ansible has a large official precedence list. Beginners can start with the practical shape before memorizing every row. From lower to higher, Ansible considers configuration settings, command-line options, playbook keywords, variables, and direct assignment inside some module or plugin calls.


![Precedence Stack](/content-assets/articles/article-infrastructure-as-code-ansible-variables-facts-precedence/precedence-stack.png)

*The precedence stack shows how role defaults, inventory values, play values, set_fact, and extra vars compete for one final value.*

That shape explains a common surprise. A command-line option such as `-u deploy` sets the remote user as an option. A variable such as `ansible_user` can still override it because variables sit higher than ordinary command-line options. Passing `-e ansible_user=breakglass` is even stronger because extra variables are high-precedence variables.

Inside the variable category, the official list is long. A useful daily pattern is this: role defaults are weak, inventory and play variables are stronger, host-specific values can beat broader group values, values created during the run can affect later tasks, and extra variables are among the strongest variable inputs.

This is why variable design matters. Precedence solves conflicts, and the team still has to make the intent visible. A clean repository makes the override path clear before production output surprises anyone.

| Source | Example | Best use | Cleanup expectation |
|---|---|---|---|
| Role defaults | `roles/orders_api/defaults/main.yml` | Friendly reusable starting values | Rarely urgent |
| Group vars | `inventories/prod/group_vars/prod_web.yml` | Environment or service-group intent | Reviewed like app config |
| Host vars | `inventories/prod/host_vars/orders-web-02.yml` | One-host exception | Add reason and expiry |
| Play vars | `vars:` inside a play | Values that belong to that play shape | Keep narrow |
| Registered/set facts | `register`, `set_fact` | Decisions made during this run | Ends with the run unless cached |
| Extra vars | `-e @release-vars.yml` | One release or rollback event | Store with job evidence |

## Defaults, Environments, and Host Exceptions
<!-- section-summary: Healthy precedence starts with weak defaults and moves to narrower values only when the context really needs them. -->

A role default is a good home for the weakest useful value. It makes the role runnable without forcing every caller to define every setting. For the orders API role, defaults might look like this:

```yaml
orders_api_log_level: info
orders_api_listen_port: 8080
orders_api_config_dir: /etc/orders-api
orders_api_health_path: /health
```

Production inventory can override values that truly belong to production. These values are stronger because the environment is making a real decision.

```yaml
orders_api_log_level: warn
orders_api_public_name: orders.example.com
orders_api_database_host: orders-db.prod.internal
```

A host variable should usually be a narrow exception. During an incident, the team might enable debug logging on one host, and that exception should be easy to find later.

```yaml
orders_api_log_level: debug
orders_api_debug_reason: "Investigating checkout timeout on 2026-06-13"
```

That host variable should have a cleanup plan. It is stronger than the production group value for that host, so it can outlive the incident and quietly keep one server different from the rest of the fleet. Many teams add an incident ticket number or expiry note near temporary host exceptions so the override is easy to remove later.

Inventory group relationships can also create surprises. A host can belong to several groups, and sibling group values can collide. Clear group naming helps, and so does avoiding duplicate ownership. A value such as `orders_api_database_host` should have one obvious inventory home rather than appearing in several sibling groups that happen to include the same host.

## Extra Variables and Release Inputs
<!-- section-summary: Extra variables are strong runtime inputs, so they work well for release events and poorly for hidden long-term configuration. -->

Extra variables come from `-e` or `--extra-vars`. They have very high precedence, which makes them useful for values that belong to one run. A release version is a good example because the repository can avoid a commit for every deployment event.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml -e orders_api_release=2026.06.13
```

For several release values, a file is easier to review and store with the pipeline run. The file also preserves YAML types more clearly than a long command line.

```yaml
orders_api_release: "2026.06.13"
orders_api_deploy_reason: "checkout totals fix"
orders_api_canary_size: 1
```

Then the job can call the file directly. The job log should preserve which file or values were used.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml -e @release-vars.yml
```

Extra variables become risky when they carry stable environment settings. If production only works because the job always passes `-e orders_api_database_host=orders-db.prod.internal`, part of production lives outside repository review. A manual run without that extra variable can render a different config.

The production habit is simple. Use extra variables for release events, emergency overrides, and explicit operator input. Move long-lived environment configuration back into inventory or role configuration after the emergency ends.

## Facts, Registered Results, and set_fact
<!-- section-summary: Values created during a run can influence later tasks, so they should have precise names and short lifetimes. -->

Facts are variables that Ansible gathers from the host. Registered results are variables created from task output. `set_fact` creates host variables during the run. These values are useful because the playbook can react to live evidence instead of only static inventory.

For example, a playbook can derive a local config path after it reads host facts. That derived value is useful for later tasks in the same run.

```yaml
- name: Select orders API service manager
  ansible.builtin.set_fact:
    orders_api_service_manager: "{{ 'systemd' if ansible_facts.service_mgr == 'systemd' else 'unknown' }}"
```

That value can drive later tasks on the same host. It should have a clear prefix and a short purpose. A name like `orders_api_service_manager` tells the reader that the value belongs to this role and came from host state.

Registered results behave the same way for output. A validation task can register a result, and a later task can branch from `config_validation.rc`. This is powerful. The value only exists after the registering task has run for that host, so a later condition should handle skipped tasks and missing fields carefully.

Extra variables can still override many values created elsewhere. That is one reason `-e` should be treated like a strong operator decision. If the command line says `-e orders_api_service_manager=manual`, the playbook may receive that value even though a task tried to derive a value from facts.

## Auditing the Winning Value
<!-- section-summary: Operators can inspect compiled inventory and add controlled debug tasks to prove which value Ansible selected. -->

When a rendered file contains the wrong value, start by asking what Ansible selected for one host. The `ansible-inventory --host` command shows compiled inventory values for a host before the playbook runs. It is a good first check for group and host variable problems.


![Audit Winning Value](/content-assets/articles/article-infrastructure-as-code-ansible-variables-facts-precedence/audit-winning-value.png)

*The audit flow shows how to check safe debug output, inventory data, and release inputs before changing the source that actually won.*

```bash
ansible-inventory -i inventories/prod/hosts.yml --host orders-web-01.example.com
```

Inside a playbook, a debug task can show the final value at the moment a task runs. This is useful because play variables, role variables, facts, and `set_fact` values may affect runtime state in ways inventory output alone may miss.

```yaml
- name: Show selected orders API log level
  ansible.builtin.debug:
    var: orders_api_log_level
  tags:
    - debug-values
```

Then a targeted run can call only that troubleshooting tag. The normal deploy path stays quieter.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-01.example.com --tags debug-values
```

Use this pattern carefully around secrets. Debug output can land in terminal scrollback, CI artifacts, or controller job history. For non-secret values such as ports, hostnames, log levels, and release versions, it gives a clean way to prove the selected value.

Search also matters. A role-specific variable name makes it easy to find every source, and that makes collisions easier to explain.

```bash
rg "orders_api_log_level" inventories roles playbooks
```

If the search returns six different owners for one stable value, the team has a design problem. Overrides are healthy when each one has a clear owner, reason, and cleanup path.

## Common Precedence Failures and Rollback
<!-- section-summary: Precedence problems usually come from hidden extra vars, stale host exceptions, sibling group collisions, or generic variable names. -->

The most common precedence failure is a hidden extra variable. A pipeline passes a value that nobody sees during code review, and the repository appears to say one thing while production receives another. The fix is to log release variable files, keep them with the run record, and move stable values into inventory.

A stale host exception is another common problem. During an incident, `orders-web-02` gets `orders_api_log_level: debug`. Two weeks later, one host still logs differently and nobody remembers why. The fix is to annotate temporary host variables and remove them during incident cleanup.

Sibling group collisions are harder to spot. A host belongs to both `prod_web` and `blue_pool`, and both groups define `orders_api_log_level`. Ansible will choose a winner based on inventory merge rules. The better fix is to decide which group owns the value: pool membership might own rollout behavior, while environment groups own service configuration.

Rollback is mostly about restoring the intended source. If an extra variable caused the bad config, rerun without the extra variable or with the previous approved release file. If a repository variable caused it, revert that variable and run the playbook against a canary host. If a host exception caused it, remove the host variable and confirm that `ansible-inventory --host` now shows the group value.

```bash
ansible-inventory -i inventories/prod/hosts.yml --host orders-web-02.example.com
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-02.example.com --check --diff
```

Those two checks prove the selected value and preview the file change before the rollback touches the host. After the real rollback run, the recap should show the expected changed tasks and zero failures.

## Putting It All Together
<!-- section-summary: Precedence works well when the team can explain why each stronger value exists and when it should be removed. -->

The orders platform now has a predictable value flow. Role defaults provide weak starting values. Production inventory supplies stable environment settings. Host variables carry rare, documented exceptions. Extra variables carry release inputs. Facts, registered results, and `set_fact` values help the playbook react during a run.


![Precedence Summary](/content-assets/articles/article-infrastructure-as-code-ansible-variables-facts-precedence/precedence-summary.png)

*The summary keeps precedence practical: choose a home, document overrides, audit the winner, and protect extra vars.*

When `orders-web-02` renders `debug` for `orders_api_log_level`, the team should be able to explain the source quickly. If the answer is a temporary host variable, it should have an owner and a cleanup path. If the answer is an extra variable, it should appear in the deployment record.

Precedence is a powerful feature because it allows reuse and overrides. It stays safe when the strongest values are visible, intentional, and short-lived where possible.

## What's Next

Variables describe values the team supplies or creates. Facts describe what Ansible observes from each host. The next article shows how facts and conditionals let one playbook adapt to operating systems, service managers, interfaces, and feature flags.

---

**References**

- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html) - Official precedence guide for configuration settings, command-line options, playbook keywords, variables, direct assignment, and extra variables.
- [Using variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html) - Official guide to variable definition, extra variables, registered variables, and variable usage.
- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html) - Official inventory guide, including group and host variables and variable merging behavior.
- [Discovering variables: facts and magic variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_vars_facts.html) - Official guidance for facts, magic variables, and values discovered from hosts.
- [ansible.builtin.set_fact](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/set_fact_module.html) - Official module reference for creating host variables and facts during a playbook run.
- [ansible.builtin.debug](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/debug_module.html) - Official module reference for printing variables during troubleshooting.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for `--extra-vars`, tags, limits, check mode, and diff mode.
