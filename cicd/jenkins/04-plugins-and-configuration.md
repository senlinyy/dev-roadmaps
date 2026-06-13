---
title: "Plugins and Configuration"
description: "Eliminate manual snowflake installations, configure systems declaratively using Jenkins Configuration as Code, and build immutable Docker controllers."
overview: "Operating a Jenkins controller through manual UI changes creates fragile environments that teams struggle to reproduce. Learn how pinned plugin sets, Jenkins Configuration as Code, reload and restart decisions, and a steady upgrade cadence make Jenkins operations safer."
tags: ["jenkins", "jcasc", "configuration-as-code", "docker"]
order: 4
id: article-cicd-jenkins-plugins-and-configuration
aliases:
  - /cicd/jenkins/plugins-and-configuration
---

## Table of Contents

1. [Why Controller Configuration Becomes a Risk](#why-controller-configuration-becomes-a-risk)
2. [Version Pinning with plugins.txt](#version-pinning-with-pluginstxt)
3. [Anatomy of jenkins.yaml](#anatomy-of-jenkinsyaml)
4. [Dependency Hell](#dependency-hell)
5. [Reload vs Restart](#reload-vs-restart)
6. [An Upgrade Cadence That Survives](#an-upgrade-cadence-that-survives)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Why Controller Configuration Becomes a Risk
<!-- section-summary: A Jenkins controller becomes risky when plugins, security settings, credentials references, and agent definitions live only as manual UI state. -->

A Jenkins controller has two kinds of operational state. The first kind is runtime state, such as build history, queued work, logs, and workspaces. The second kind is configuration state, such as installed plugins, security realm, authorization strategy, global tools, cloud agents, credentials references, and system messages. Runtime state helps you understand what happened. Configuration state decides what the controller can do next.

Summit Retail starts with one manually configured controller. An administrator installs plugins through the UI, creates local users, adds a role strategy, configures Kubernetes agents, and pastes tool paths into Manage Jenkins. Six months later, the controller is important enough that every release depends on it, but nobody can rebuild the same controller from a clean machine without clicking through pages from memory.

That kind of controller is often called a **snowflake**. A snowflake controller has a unique history of manual changes, plugin upgrades, saved forms, and emergency fixes. It may work today, but it creates fear around every upgrade because the team cannot confidently reproduce it in staging or roll it back after a bad change.

The production target is a **repeatable controller**. The plugin set comes from a versioned file. The controller configuration comes from YAML. The image build installs plugins before startup. A staging controller boots from the same inputs as production. A rollback means running a previous controller image and configuration version, then restoring compatible state if needed.

This article follows the path from manual state to repeatable state. First the team pins plugin binaries. Then they write `jenkins.yaml` for controller configuration. After that they learn how plugin dependencies fail, when JCasC reload is enough, when a restart is needed, and how to schedule upgrades without turning every Friday into a release freeze.

## Version Pinning with plugins.txt
<!-- section-summary: A pinned plugins.txt makes the controller plugin set reviewable, rebuildable, and testable before production startup. -->

Jenkins plugins are packaged extension files that add features to the controller. Pipelines, Git integrations, credentials bindings, Kubernetes agents, role-based authorization, and Configuration as Code all arrive through plugins. Jenkins can install plugins through the web UI, the Jenkins CLI, or the plugin installation manager used by the official Docker image.

A **pinned plugin set** is a file that lists plugin IDs and exact versions. In many Jenkins Docker builds, the file is called `plugins.txt`. The official plugin installation manager, available as `jenkins-plugin-cli` in the Jenkins Docker image, reads that file, resolves dependencies, downloads plugin files, and reports compatibility or security warnings.

The file shape looks like this:

```bash
configuration-as-code:1998.v3e50e6e9d3d1
credentials-binding:725.ve52b_2328a_fde
git:5.8.0
kubernetes:4384.v1b_6367f393d9
role-strategy:840.v206ff7f7312e
workflow-aggregator:608.v67378e9d3db_1
```

Those version numbers are examples from a tested controller image, not a shopping list to copy blindly. A real team gets plugin versions from a staging update plan, reviews Jenkins security advisories, runs the plugin manager, boots a staging controller, and then commits the tested plugin file. The important pattern is `plugin-id:version`, because a controller build should install the same plugin set every time.

A Dockerfile can install that file during image build:

```dockerfile
FROM jenkins/jenkins:lts-jdk21

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

COPY jenkins.yaml /usr/share/jenkins/ref/jenkins.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/jenkins.yaml
```

This gives Summit Retail a controller image that carries the intended plugin binaries and the intended configuration file. The running container still writes operational state to `$JENKINS_HOME`, but the controller image documents how the software and configuration were produced.

Pinning top-level plugins is only the first layer. Plugins have dependencies, and those dependencies also have versions. The plugin manager resolves that tree during the build. Real teams keep the build output as evidence, because the resolved dependency tree matters when a later upgrade changes a plugin that nobody wrote directly in `plugins.txt`.

## Anatomy of jenkins.yaml
<!-- section-summary: jenkins.yaml describes controller settings in YAML, including system settings, tools, plugins, credentials references, and access control. -->

**Jenkins Configuration as Code**, usually shortened to **JCasC**, lets administrators describe controller configuration in YAML. Instead of clicking through Manage Jenkins pages and hoping the controller keeps the right XML files, the team stores the intended configuration in Git. Jenkins reads the YAML and applies those settings to the controller.

The default JCasC file has several common top-level areas. `jenkins` configures the root Jenkins object, such as executors, mode, nodes, security realm, and authorization. `tool` configures tools such as JDK, Maven, or Git installations. `unclassified` configures many plugin-specific global settings. `credentials` can define credentials entries, although teams often combine JCasC with external secret systems or environment variables so raw secrets stay out of Git.

Here is a small `jenkins.yaml` for Summit Retail:

```yaml
jenkins:
  systemMessage: "summit-retail Jenkins controller managed by code"
  numExecutors: 0
  mode: EXCLUSIVE
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: "summit-admin"
          password: "${SUMMIT_ADMIN_PASSWORD}"
  authorizationStrategy:
    roleBased:
      roles:
        global:
          - name: "admin"
            permissions:
              - "Overall/Administer"
            assignments:
              - "summit-admin"
tool:
  maven:
    installations:
      - name: "maven-3.9"
        home: "/opt/tools/maven-3.9"
unclassified:
  location:
    url: "https://jenkins.summit.example/"
```

This file defines the controller's identity. It sets the system message, removes controller executors, disables public signup, creates an administrator from an environment-backed password, assigns the admin role, registers a Maven tool, and sets the Jenkins URL. A reviewer can inspect all of that in a pull request.

The YAML still needs care. Indentation changes meaning. Plugin configuration keys depend on the installed plugin versions. Some values, such as `false`, `yes`, and numbers, can become YAML booleans or numeric types. The JCasC UI can export current configuration, and many teams use that export as a starting point before trimming noisy or environment-specific values.

The file should also separate **configuration** from **secret value**. A credentials entry can reference `${VARIABLE_NAME}`, and the actual value can come from the runtime environment, Kubernetes secret, Docker secret, Vault integration, or another secret manager. The article on credentials explains the secret side in detail. For this article, the key idea is simple: Git should hold the shape of the controller, while secret stores hold secret values.

## Dependency Hell
<!-- section-summary: Plugin dependency failures come from version constraints, removed APIs, mixed plugin trees, and controller-core compatibility. -->

Jenkins plugin failures can look dramatic because plugins run inside the same controller process. One plugin update can add a dependency on a newer library. Another plugin can still call an older API. A controller upgrade can raise the minimum Jenkins core version that a plugin expects. The result can appear as boot failures, missing dependency warnings, broken pipeline steps, or Java errors such as `NoSuchMethodError`.

That family of problems often gets called **dependency hell**. In Jenkins, it usually means the installed plugin tree has versions that cannot work together cleanly. The problem can happen after a UI update, a partial rollback, a manually copied `.hpi` file, or a `plugins.txt` change that was never tested on a staging controller.

Summit Retail sees this after upgrading the Git plugin. Checkout starts failing with a Java method error in `git-client`. The team checks Manage Jenkins, System Information, and the plugin manager output from the image build. They discover that the Git plugin expects a newer `git-client` dependency than the one baked into the controller image.

There are a few common patterns:

| Failure pattern | What it means | Safer response |
|---|---|---|
| Missing dependency | A plugin requires another plugin that the controller lacks | Rebuild the image through `jenkins-plugin-cli` and test the resolved set |
| Minimum version conflict | One plugin needs a newer dependency version | Let the plugin manager resolve the higher version, then stage the full set |
| Runtime API error | A plugin calls a method that the loaded dependency lacks | Roll back the plugin set or update the related plugin family together |
| Core version mismatch | A plugin requires a newer Jenkins core | Upgrade Jenkins LTS in staging before using that plugin version |
| Partial manual update | UI state and image state diverge | Rebuild from `plugins.txt` and remove manual plugin changes from production |

The safe habit is to upgrade a plugin set, not one lonely plugin on a live controller. A plugin set includes the requested plugins, transitive dependencies, Jenkins core version, Java version, and JCasC file that configures them. The staging controller should boot from the same image pattern as production so dependency errors appear before the production restart window.

Plugin health and security warnings also matter. The Jenkins plugin site shows health scores, maintainers, releases, dependencies, and previous security warnings. A plugin with low maintenance signals may still be necessary, but the team should know that risk before placing it in a production controller.

## Reload vs Restart
<!-- section-summary: JCasC reload applies many YAML configuration changes, while plugin binaries and some core settings need a controller restart. -->

Jenkins operators need to know which changes can reload safely and which changes need a restart. A **reload** asks Jenkins or a plugin to re-read configuration while the controller keeps running. A **restart** stops the controller process and starts it again, which reloads plugin classes, JVM settings, startup environment, and controller initialization code.

JCasC supports reloading existing configuration from the Configuration as Code page or through automation. This works well for many YAML-only changes, such as a system message, a tool path, a role assignment, or a plugin setting that the plugin supports during reload. Summit Retail uses reload for small, tested JCasC edits during a normal operations window.

Plugin binary changes need a restart. Jenkins loads plugin classes during startup, so installing or changing a `.jpi` file in the plugin directory does not give every running pipeline a clean new classpath. A controller image with a new `plugins.txt` should boot as a new controller process in staging first, then production during a planned window.

JVM setting changes also need a restart. Heap size, garbage collector settings, Java version, and `JAVA_OPTS` apply when the Java process starts. A JCasC reload can change Jenkins configuration, but it cannot change the memory flags of the process that is already running.

The decision table looks like this:

| Change | Usually enough | Why |
|---|---|---|
| System message in `jenkins.yaml` | JCasC reload | Jenkins can apply the setting at runtime |
| Role assignment in `jenkins.yaml` | JCasC reload | Authorization config can refresh from YAML |
| New credential reference shape | JCasC reload plus validation | The config changes, while secret availability still needs a runtime check |
| New plugin version | Restart from a tested image | Plugin classes load at startup |
| Jenkins LTS version bump | Restart from a tested image | Core application changes at process startup |
| Heap size or Java flags | Restart | JVM flags apply when Java starts |
| Agent pod template in JCasC | Reload plus a test build | New agent definitions should be exercised by a real job |

The safest reload process still includes validation. Summit Retail applies the YAML change on staging, checks the JCasC export and UI, runs a sample pipeline that uses the affected setting, then applies the same commit to production. Reload is convenient, but staging proves that the setting works with the installed plugin versions.

## An Upgrade Cadence That Survives
<!-- section-summary: Jenkins upgrades work best as a steady pipeline with staging, evidence, rollback notes, and regular security review. -->

Jenkins upgrades become painful when they happen only during emergencies. A team that waits six months may face a large Jenkins LTS jump, many plugin updates, Java changes, deprecated APIs, and security fixes all at once. A steady cadence keeps each change small enough to inspect.

Summit Retail uses a monthly controller maintenance lane. During week one, a scheduled job checks available plugin updates and Jenkins LTS notes. During week two, the platform team updates `plugins.txt` in a branch, rebuilds the controller image, boots staging, and runs representative pipelines. During week three, service teams try critical deployment jobs on staging. During week four, production receives the tested image during a planned window.

The upgrade pull request carries a small evidence pack:

- The old and new Jenkins LTS version.
- The old and new `plugins.txt` diff.
- The plugin manager output or resolved plugin list.
- Security advisories reviewed and addressed.
- JCasC validation result.
- Staging boot result.
- Representative pipeline results for Maven, Node.js, Docker, Kubernetes deploys, and shared-library consumers.
- Rollback image tag and any state compatibility notes.

Rollback planning matters because Jenkins state can change during startup. A plugin can migrate job configuration or credential metadata. A controller rollback may need a restored backup of `$JENKINS_HOME` that matches the previous plugin set. The team should write the rollback note before production rollout, while everyone still has context.

Security updates deserve a shorter path. If a Jenkins security advisory affects an exposed controller or a plugin that handles credentials, the team can run an accelerated version of the same process. The process stays the same: update file, build image, boot staging, run smoke jobs, record rollback path, then roll production. The timeline changes, not the discipline.

## Putting It All Together
<!-- section-summary: Repeatable Jenkins operations come from treating plugins, controller config, staging, and upgrades as reviewed delivery artifacts. -->

Summit Retail now treats the Jenkins controller like a product. The controller image installs plugins from `plugins.txt`. JCasC applies the reviewed `jenkins.yaml`. The staging controller boots from the same build pattern as production. Reloads handle supported configuration changes, and restarts handle new plugin binaries, Jenkins core changes, and JVM settings.

The team also knows how to investigate plugin failures. A missing dependency points to the resolved plugin set. A runtime method error points to version compatibility. A JCasC failure points to plugin configuration shape. A production upgrade plan includes rollback notes and a backup strategy instead of a vague hope that the old container image will work with new state.

This gives the shared-library work from the previous article a stable home. Pipeline code can be clean, but the controller must also be reproducible. Pinned plugins and Configuration as Code turn Jenkins administration into something the same engineering review process can understand.

## What's Next
<!-- section-summary: The next article focuses on the credentials and security boundaries that protect Jenkins from leaking deploy power. -->

Now the controller can be rebuilt and upgraded with discipline. The next risk is more sensitive: secrets. Jenkins often holds registry passwords, cloud deploy credentials, SSH keys, API tokens, and OIDC tokens that can reach production systems.

The final Jenkins article covers credentials and security. It shows how credentials binding works, why masking has limits, how the Groovy sandbox protects the controller, how untrusted pull requests can reach secrets, and how teams move from static cloud keys to federated credentials.

---

**References**

- [Jenkins: Managing Plugins](https://www.jenkins.io/doc/book/managing/plugins/) - Documents plugin installation, updates, dependencies, and plugin manager behavior.
- [Plugin Installation Manager Tool for Jenkins](https://github.com/jenkinsci/plugin-installation-manager-tool) - Documents `jenkins-plugin-cli`, `--plugin-file`, dependency resolution, updates, and plugin input formats.
- [Jenkins: Configuration as Code](https://www.jenkins.io/doc/book/managing/casc/) - Explains JCasC YAML, SCM storage, reload behavior, file location, and plugin configuration.
- [Jenkins: Docker installation](https://www.jenkins.io/doc/book/installing/docker/) - Documents the official Jenkins Docker image, `/var/jenkins_home`, Java requirements, and Docker-based controller setup.
- [Jenkins Plugin Site](https://plugins.jenkins.io/) - Provides plugin versions, dependencies, health scores, maintainers, releases, and security warning history.
