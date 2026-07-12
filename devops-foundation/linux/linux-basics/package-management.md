---
title: "Package Management"
description: "Install, update, and manage software packages using apt, yum, and other Linux package managers."
overview: "Use Linux package managers to install, update, pin, audit, and remove the software that keeps a Linux server running safely."
tags: ["apt", "yum", "dnf"]
order: 6
id: article-devops-foundation-linux-linux-basics-package-management
---

## Table of Contents

1. [Why Package Management Matters](#why-package-management-matters)
2. [What a Package Manager Does](#what-a-package-manager-does)
3. [APT on Debian and Ubuntu](#apt-on-debian-and-ubuntu)
4. [DNF on Fedora, RHEL, and Rocky](#dnf-on-fedora-rhel-and-rocky)
5. [Repositories and Trust](#repositories-and-trust)
6. [Third-Party Software and Version Pinning](#third-party-software-and-version-pinning)
7. [Security Updates and Maintenance Windows](#security-updates-and-maintenance-windows)
8. [Remove, Roll Back, and Audit Packages](#remove-roll-back-and-audit-packages)
9. [References](#references)

## Why Package Management Matters
<!-- section-summary: Package management controls how server software is installed, updated, verified, and removed. -->

Sooner or later you SSH into a server and one small missing tool blocks the work. Nginx has to serve traffic, `curl` is missing during a health check, or OpenSSL needs a security fix before the next maintenance window. Copying random files onto the machine can solve the immediate error and leave the next operator with no clear source, version, or update path.

**Package management** is how Linux installs, updates, verifies, and removes software in a controlled way. A server needs packages for web servers such as Nginx, service tools such as systemd, TLS libraries such as OpenSSL, health-check tools such as `curl`, and application runtimes such as Node.js, Python, Go, or Java.

A **package manager** handles software as managed units instead of loose files copied around by hand. It knows which package installed `/usr/sbin/nginx`, which dependencies that package needs, which repository supplied it, and which updates are available.

This matters because unmanaged software creates mystery. If someone built a binary on their laptop and copied it into `/usr/local/bin`, the next engineer may not know its version, source, patch status, or removal procedure. Packages give the server an inventory and a repeatable way to change that inventory.

For a beginner, the first move is simple: ask the package manager what it knows before you change the machine. That habit keeps installs, upgrades, and removals from turning into guesswork.

## What a Package Manager Does
<!-- section-summary: Package managers install files, resolve dependencies, verify repository metadata, track ownership, and support updates. -->

Suppose a fresh Ubuntu server needs Nginx. If you copy only `/usr/sbin/nginx` onto the server, the binary may exist but the service still lacks the pieces around it: the service file, default directories, shared libraries, log rotation, documentation, and a record of which version was installed. The package manager handles that whole change as one managed operation.

A **package** is the managed unit. It includes an archive of files plus metadata. The archive contains the files that land on disk. The metadata names the package, version, dependencies, checksums, install scripts, and repository source.

That metadata matters because software rarely stands alone. Nginx may need shared libraries before it can run. It may also need a service file so systemd can manage it, a logrotate rule so logs do not grow forever, and directories created during installation. The package manager reads the metadata, builds a plan, downloads the needed packages, verifies them, unpacks files, runs package scripts, and records the result in its local database.

On Debian and Ubuntu systems, the package format is `.deb`, and the main tool family is APT. On Fedora, RHEL, CentOS Stream, Rocky Linux, and AlmaLinux, the package format is `.rpm`, and the modern tool is DNF. Older Red Hat style systems may still use `yum`, which DNF replaced in many distributions.

The package manager does several jobs:

| Job | Example |
|---|---|
| Install software | Add Nginx and its dependencies |
| Upgrade software | Apply OpenSSL security updates |
| Remove software | Uninstall a runtime the application no longer uses |
| Query ownership | Identify which package installed `/usr/bin/curl` |
| Verify integrity | Compare installed files with package metadata |
| Manage repositories | Enable official or trusted third-party sources |

The practical server rule is to prefer OS packages for system software. Nginx, logrotate, systemd tooling, CA certificates, and security libraries should come from trusted repositories whenever possible. Application dependencies can still come from language tools like `npm`, `pip`, or `cargo`, but the base server should stay visible to the OS package manager.

The production symptom of weak package metadata is mystery. A binary exists at `/usr/local/bin/tool`, and nobody knows which version it is, which files belong to it, or how to remove it. With a managed package, the next decision is easier: query the package owner, inspect the version, check the repository, then decide whether to upgrade, pin, remove, or rebuild.

![Package manager pipeline infographic showing repository metadata, dependency solving, download, verification, install, and service restart planning](/content-assets/articles/article-devops-foundation-linux-linux-basics-package-management/package-manager-pipeline.png)

_The image shows package management as a controlled pipeline rather than a single install command._

## APT on Debian and Ubuntu
<!-- section-summary: APT installs and updates `.deb` packages from configured repositories on Debian-style systems. -->

On an Ubuntu server, the practical task may be simple: install `curl` for health checks and Nginx for the public proxy. Before APT can install the right packages, it needs a current local list of what the configured repositories offer. Think of this as checking the catalog before placing the order.

APT keeps that list as a **local package index**. The index is metadata, not the package files themselves. It tells APT which package names exist, which versions are available, where to download them, and what dependencies they require.

Refresh that local package index before installing or upgrading packages:

```bash
sudo apt update

# Example output:
# Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease
# Get:2 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]
# Get:3 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]
# Fetched 252 kB in 1s (342 kB/s)
# Reading package lists... Done
# Building dependency tree... Done
# Reading state information... Done
# 12 packages can be upgraded. Run 'apt list --upgradable' to see them.
```

`apt update` downloads the latest package lists from configured repositories. It does not upgrade installed packages yet. The final line is the important one: APT has found 12 installed packages with newer versions available.

Preview those packages before making changes:

```bash
apt list --upgradable

# Example output:
# Listing... Done
# curl/noble-updates 8.5.0-2ubuntu10.6 amd64 [upgradable from: 8.5.0-2ubuntu10.4]
# libssl3t64/noble-security 3.0.13-0ubuntu3.5 amd64 [upgradable from: 3.0.13-0ubuntu3.4]
# nginx/noble-updates 1.24.0-2ubuntu7.3 amd64 [upgradable from: 1.24.0-2ubuntu7.2]
```

This output tells you three things:

- The package name is on the left, such as `nginx`.
- The repository pocket appears after the slash, such as `noble-updates` or `noble-security`.
- The bracketed text shows the currently installed version.

Installing Nginx and common operating tools looks like this:

```bash
sudo apt install nginx curl ca-certificates logrotate

# Example output:
# The following NEW packages will be installed:
#   nginx nginx-common
# The following packages will be upgraded:
#   ca-certificates curl logrotate
# Need to get 2,184 kB of archives.
# After this operation, 1,536 kB of additional disk space will be used.
# Do you want to continue? [Y/n]
```

APT is showing the transaction before it changes the system. `NEW packages` are not installed yet. `upgraded` packages already exist on the server. The disk-space line helps you catch surprises on small machines.

This is dependency resolution in action. APT is solving the question, "Which packages must change together so the requested package works?" If installing one small tool wants to remove a runtime or upgrade a core library, pause at this summary. The next decision is to accept the plan, change the requested package, or test the transaction on a safer machine first.

Upgrading installed packages uses:

```bash
sudo apt upgrade

# Example output:
# Calculating upgrade... Done
# The following packages will be upgraded:
#   curl libssl3t64 nginx openssl
# 4 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
# Need to get 4,912 kB of archives.
# Do you want to continue? [Y/n]
```

For production work, pause at this summary. An update to Nginx, OpenSSL, or an application runtime may be routine, but you still want to know what will change before accepting the prompt.

APT can answer ownership questions. If you see a binary and want to know where it came from, ask `dpkg`:

```bash
dpkg -S /usr/sbin/nginx

# Example output:
# nginx-core: /usr/sbin/nginx
```

This says the file `/usr/sbin/nginx` belongs to the installed package `nginx-core`.

Then inspect package metadata:

```bash
apt show nginx

# Example output:
# Package: nginx
# Version: 1.24.0-2ubuntu7.3
# Priority: optional
# Section: web
# Origin: Ubuntu
# Depends: nginx-common, nginx-core
# Description: small, powerful, scalable web/proxy server
```

The metadata tells you which version APT knows about, which source provides it, and which dependencies come with it.

APT also keeps history. After a surprising change, inspect the logs:

```bash
sudo less /var/log/apt/history.log
```

```bash
sudo less /var/log/apt/term.log
```

The history log shows which packages changed and when. The terminal log records detailed installation output. Those files help you decide whether to roll back, pin a version, or fix a config prompt that appeared during upgrade.

## DNF on Fedora, RHEL, and Rocky
<!-- section-summary: DNF installs and updates `.rpm` packages on Red Hat style systems and keeps transaction history. -->

On a Rocky Linux, Fedora, AlmaLinux, or RHEL-style server, the job is familiar: install the tools the service needs, preview updates before a window, and keep a record of what changed. The command words change from APT words to DNF words. The package format changes from `.deb` to `.rpm`. The careful habit stays the same.

DNF talks a lot about **metadata**, **repositories**, and **transactions**. Metadata is the package catalog from enabled repositories. A transaction is the full planned change DNF builds before it touches the machine. When you ask for Nginx, DNF may also add `nginx-core`, pull from `appstream`, and show a prompt before it installs anything.

Check available updates before a maintenance window:

```bash
sudo dnf check-update

# Example output:
# Last metadata expiration check: 0:08:14 ago on Wed 24 Jun 2026 09:12:30 AM UTC.
# curl.x86_64        8.6.0-5.el9_4.2       baseos
# nginx.x86_64       1:1.24.0-4.el9        appstream
# openssl.x86_64     1:3.2.2-6.el9_4       baseos
```

Plain-English reading of this output:

- `Last metadata expiration check` tells you how fresh the local repository metadata is.
- `curl.x86_64`, `nginx.x86_64`, and `openssl.x86_64` are installed packages with updates available.
- The middle value is the version DNF would move to.
- `baseos` and `appstream` are the repositories that would supply those updates.

The next decision is scope. If the preview only contains routine packages you planned to update, continue with the window. If it includes OpenSSL, Nginx, a runtime, or packages from a surprising repository, pause and decide whether the service needs extra testing or a narrower update. `dnf check-update` may return a nonzero status when updates exist, so automation should handle that result deliberately.

Install Nginx and useful tools:

```bash
sudo dnf install nginx curl ca-certificates logrotate

# Example output:
# Dependencies resolved.
# ================================================================================
#  Package             Architecture Version              Repository        Size
# ================================================================================
# Installing:
#  nginx               x86_64       1:1.24.0-4.el9       appstream        36 k
# Installing dependencies:
#  nginx-core          x86_64       1:1.24.0-4.el9       appstream       570 k
#
# Transaction Summary
# ================================================================================
# Install  2 Packages
# Total download size: 606 k
# Is this ok [y/N]:
```

Plain-English reading of this install preview:

- `Dependencies resolved` means DNF found a complete package plan.
- `Installing` names the package you asked for directly.
- `Installing dependencies` names extra packages needed to make the requested package work.
- `Repository` tells you where each package comes from.
- `Transaction Summary` shows the size of the planned change before you answer the prompt.

This is the same install job you saw with APT, expressed in DNF language. You asked for useful server tools, DNF found the RPM packages and dependencies, then it showed the transaction. If the transaction pulls from an unexpected repository or includes removals, stop before accepting it and inspect the repository configuration.

Update installed packages:

```bash
sudo dnf upgrade

# Example output:
# Dependencies resolved.
# ================================================================================
#  Package        Architecture Version              Repository              Size
# ================================================================================
# Upgrading:
#  curl           x86_64       8.6.0-5.el9_4.2      baseos                 315 k
#  nginx          x86_64       1:1.24.0-4.el9       appstream               36 k
#
# Transaction Summary
# ================================================================================
# Upgrade  2 Packages
# Is this ok [y/N]:
```

Plain-English reading of this upgrade preview:

- `Upgrading` means these packages already exist on the server.
- The `Version` column shows the exact target release.
- The `Repository` column helps confirm the update comes from an expected source.
- `Upgrade 2 Packages` is the total planned change at the prompt.

The next decision is whether the window is allowed to change those packages now. A `curl` update may be low risk. An `nginx`, `openssl`, or runtime update may need service checks, restart planning, or a rollback note before you type `y`.

Query package ownership with RPM:

```bash
rpm -qf /usr/sbin/nginx

# Example output:
# nginx-core-1.24.0-4.el9.x86_64
```

This output says the file `/usr/sbin/nginx` came from the installed RPM package `nginx-core-1.24.0-4.el9.x86_64`. That helps when you find a binary and need to know whether the OS package manager owns it.

Then inspect the package through DNF:

```bash
dnf info nginx

# Example output:
# Name         : nginx
# Version      : 1.24.0
# Release      : 4.el9
# Architecture : x86_64
# Repository   : appstream
# Summary      : A high performance web server and reverse proxy server
```

Plain-English reading of this metadata:

- `Name`, `Version`, and `Release` identify the package DNF knows about.
- `Architecture` should match the machine, such as `x86_64`.
- `Repository` should be an expected source such as `appstream`.
- `Summary` gives a short human description so you can confirm you are looking at the right package.

On a server, these two commands confirm whether `/usr/sbin/nginx` came from the expected OS repository.

DNF records transactions, which is valuable after a maintenance window:

```bash
sudo dnf history

# Example output:
# ID     | Command line                 | Date and time    | Action(s) | Altered
# 42     | upgrade                      | 2026-06-24 09:30 | Upgrade   |    12
# 41     | install nginx curl logrotate | 2026-06-10 12:02 | Install   |     6
```

The history table tells you which DNF command changed packages, when it happened, and how many packages were altered. After a bad maintenance window, this is often the fastest way to identify the package transaction that needs investigation.

Inspect one transaction before trying any rollback:

```bash
sudo dnf history info 42

# Example output:
# Transaction ID : 42
# Begin time     : Wed 24 Jun 2026 09:30:11 AM UTC
# Command Line   : upgrade
# Packages Altered:
#     Upgrade  nginx-1:1.24.0-4.el9.x86_64
#     Upgrade  openssl-1:3.2.2-6.el9_4.x86_64
```

This output proves transaction `42` upgraded Nginx and OpenSSL. That evidence guides the next move: test the service, inspect logs, and choose whether a config restore, package undo, or application rollback matches the failure.

Some DNF systems support undoing a transaction:

```bash
sudo dnf history undo 42
```

Treat undo as one recovery tool among several. A package rollback may leave data migrations, config edits, or application-level changes in place. Package rollback should sit beside service health checks, config backups, and release rollback.

## Repositories and Trust
<!-- section-summary: Repositories are signed software sources, so adding one extends who can install code on the server. -->

The moment a package install asks you to enable a new source, pause. That prompt is asking for trust along with a download URL. A repository is a publisher that can provide packages, updates, metadata, and install scripts to the server over time.

A **repository** is a software source that publishes packages and metadata. Package managers verify repository metadata and package signatures so the server can detect tampering. Official distribution repositories are the safest default because the distribution maintainers build, sign, test, and patch those packages for that OS release.

Repository signing exists because packages often install files as root. The package manager must know that the metadata and packages came from a trusted publisher and were not changed on the way to the server. The trust chain usually works like this: the server has a trusted signing key, the repository publishes signed metadata, and the package manager verifies that metadata before using it.

On Ubuntu and Debian, repository configuration lives under `/etc/apt/sources.list` and `/etc/apt/sources.list.d/`. On DNF systems, repository files live under `/etc/yum.repos.d/`.

For a production server, adding a repository is a security decision. A repository can provide packages that run scripts as root during installation and upgrades. The team should know who publishes it, why the package is needed, how keys are managed, and how updates will be tested.

APT can show which repository would supply a package:

```bash
apt-cache policy nginx

# Example output:
# nginx:
#   Installed: 1.24.0-2ubuntu7.2
#   Candidate: 1.24.0-2ubuntu7.3
#   Version table:
#      1.24.0-2ubuntu7.3 500
#         500 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages
#  *** 1.24.0-2ubuntu7.2 100
#         100 /var/lib/dpkg/status
```

The `Candidate` line is the version APT would install or upgrade to. The URL below it shows the repository source.

DNF can list enabled repositories:

```bash
dnf repolist

# Example output:
# repo id        repo name
# baseos         Rocky Linux 9 - BaseOS
# appstream      Rocky Linux 9 - AppStream
# extras         Rocky Linux 9 - Extras
```

A healthy output should point at the distribution repository or an approved vendor repository. If `nginx` suddenly comes from a personal package archive or an unknown mirror, pause the maintenance work and trace how that repository was added.

The next decision after finding an unknown repository is ownership. Find the repo file, check who added it, check which signing key it uses, and list which installed packages came from it. Removing a repo without checking installed packages can strand software with no update path.

![Repository trust chain infographic showing signed metadata, trusted keys, packages, and installed files](/content-assets/articles/article-devops-foundation-linux-linux-basics-package-management/repository-trust-chain.png)

_The image makes the trust chain visible, from repository metadata to the package that lands on the server._

## Third-Party Software and Version Pinning
<!-- section-summary: Third-party repositories and pins can solve version needs, but they require explicit ownership and review. -->

Sometimes the official repository does not have the version your application needs. A Node.js service may require a newer runtime than the OS release ships, or Nginx may need a vendor-supported module. Third-party repositories can solve that version gap while expanding the server's trust boundary.

The plain rule is that a third-party repository lets another publisher feed packages into your server's update stream. That can be perfectly reasonable for a vendor-supported runtime, and it needs the same review as any other privileged software source. The package may update automatically during a normal upgrade, so the team should know how it is tested and who owns breakage.

A practical decision flow helps:

| Need | Better first option |
|---|---|
| Nginx stable web server | Distribution package |
| Security library | Distribution package |
| Newer language runtime | Vendor repository or runtime manager with documented owner |
| Application dependencies | Project lockfile and language package manager |
| One custom internal tool | Internal package repository or `/usr/local` with clear versioning |

Pinning holds a package at a chosen version or priority. On APT, a pin file can live under `/etc/apt/preferences.d/`:

```apt
Package: nginx
Pin: version 1.24.*
Pin-Priority: 1001
```

The fields tell APT which package the rule controls and how strongly to prefer the matching version:

- `Package: nginx` limits the rule to the Nginx package. Use the exact package name shown by `apt show` or `apt list`.
- `Pin: version 1.24.*` matches versions beginning with `1.24.`, so `1.24.0` and `1.24.3` match while `1.26.0` does not.
- `Pin-Priority: 1001` gives the matching version a very high priority. A priority above `1000` can force a downgrade or keep a chosen version preferred.

Because this priority can override normal upgrade behavior, the pin should be documented and reviewed.

Verify the APT decision before trusting the pin:

```bash
apt-cache policy nginx

# Example output:
# nginx:
#   Installed: 1.24.0-2ubuntu1
#   Candidate: 1.24.3-1vendor1
#   Version table:
#      1.24.3-1vendor1 1001
#         500 https://packages.vendor.example stable/main amd64 Packages
#  *** 1.24.0-2ubuntu1 100
#         100 /var/lib/dpkg/status
```

The useful clues are:

- `Installed` is the version currently on the server.
- `Candidate` is the version APT would choose for the next install or upgrade.
- The priority number beside each version shows whether a pin is affecting selection.
- A very high number, such as `1001`, means the pin can overpower normal repository priority.

On DNF, a version lock plugin is commonly used:

```bash
sudo dnf install python3-dnf-plugin-versionlock

# Example output:
# Installed:
#   python3-dnf-plugin-versionlock-4.3.0-13.el9.noarch
# Complete!
```

Then add a lock:

```bash
sudo dnf versionlock add nginx

# Example output:
# Adding versionlock on: nginx-1:1.24.0-4.el9.*
```

Verify the lock list after adding it:

```bash
sudo dnf versionlock list

# Example output:
# nginx-1:1.24.0-4.el9.*
```

That line means DNF should keep matching the `1.24.0-4.el9` Nginx build pattern instead of freely moving to another available build. If a later maintenance window expects a newer Nginx package, this lock is one of the first places to check.

Pins reduce surprise during maintenance, and they can also block security updates. A pinned package needs an owner and review date. If the team pins Nginx to avoid a breaking change, schedule the test work needed to remove that pin later.

The production symptom of a forgotten pin is a package that never receives a fix even though the repository has one. When `apt list --upgradable` or `dnf check-update` does not show an expected update, inspect pins and locks before assuming the vendor has not published it. The next decision is to keep the pin with a reason, test the newer version, or remove the pin.

![Software source ladder infographic comparing official repositories, vendor repositories, downloaded packages, and scripts from the internet](/content-assets/articles/article-devops-foundation-linux-linux-basics-package-management/software-source-ladder.png)

_The image ranks common software sources by how much trust and maintenance work they ask from the operator._

![Dependency conflict infographic showing two packages asking for incompatible library versions and a package manager blocking the unsafe mix](/content-assets/articles/article-devops-foundation-linux-linux-basics-package-management/dependency-conflict.png)

_The image shows why dependency conflicts are useful warnings, not random package-manager drama._

## Security Updates and Maintenance Windows
<!-- section-summary: Production updates need preview, backup, health checks, and a rollback path rather than blind upgrades. -->

Security updates usually enter your day as a ticket, an alert, or a maintenance window on the calendar. Libraries such as OpenSSL, glibc, and zlib sit below many programs. Nginx and application runtimes receive fixes over time. Ignoring updates leaves known vulnerabilities on a public server.

The production question is how to update while proving the service was healthy before the change and healthy after it. A checklist helps, and each step should produce evidence:

1. Capture current service state with `systemctl`.
2. Preview package changes with APT or DNF.
3. Back up important config such as `/etc/nginx` and systemd unit files.
4. Apply updates in a planned window.
5. Restart or reload services when libraries, runtimes, or service packages require it.
6. Run local and public health checks.
7. Watch service logs after the change.

Check current service state first:

```bash
systemctl status nginx app.service

# Example output:
# ● nginx.service - A high performance web server and a reverse proxy server
#      Active: active (running) since Wed 2026-06-24 08:42:10 UTC; 48min ago
#
# ● app.service - Web application
#      Active: active (running) since Wed 2026-06-24 08:43:02 UTC; 47min ago
```

Plain-English reading of this status:

- `Active: active (running)` proves systemd sees both services running before the package change.
- The `since` timestamp tells you how long each service has been up.
- If a service is already failed before the update, fix or record that state before blaming the package window later.

Preview the package change before applying it. On Ubuntu:

```bash
apt list --upgradable

# Example output:
# Listing... Done
# libssl3t64/noble-security 3.0.13-0ubuntu3.5 amd64 [upgradable from: 3.0.13-0ubuntu3.4]
# nginx/noble-updates 1.24.0-2ubuntu7.3 amd64 [upgradable from: 1.24.0-2ubuntu7.2]
```

On Rocky Linux or Fedora:

```bash
sudo dnf check-update

# Example output:
# nginx.x86_64       1:1.24.0-4.el9        appstream
# openssl.x86_64     1:3.2.2-6.el9_4       baseos
```

The preview tells you what the update window is about. A web server update means you need Nginx syntax checks and HTTP health checks. A TLS library update may require service restarts so running processes load the fixed library. A runtime update may need application smoke tests.

Back up Nginx config before changing packages or reload behavior:

```bash
sudo tar -czf /root/etc-nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz /etc/nginx
```

Then apply the chosen updates:

```bash
sudo apt upgrade
```

After the package change, validate and reload Nginx:

```bash
sudo nginx -t

# Example output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

This output proves the Nginx configuration still parses after the package change. It does not prove users can reach the application, so continue with service reload and HTTP checks.

```bash
sudo systemctl reload nginx
```

Run health checks from both local and public paths when possible:

```bash
curl --fail --silent --show-error http://127.0.0.1:8080/health

# Example output:
# ok
```

```bash
curl --fail --silent --show-error https://example.com/health

# Example output:
# ok
```

Plain-English reading of the health checks:

- The local check proves the application answers from the server itself.
- The public check proves DNS, TLS, firewall rules, reverse proxy behavior, and the application path work from outside.
- `--fail` makes HTTP 400 and 500 responses count as command failures instead of quiet success.

Then watch logs while traffic returns:

```bash
sudo journalctl -u nginx -u app.service --since "10 minutes ago" --no-pager

# Example output:
# Jun 24 09:42:03 web-01 systemd[1]: Reloaded nginx.service.
# Jun 24 09:42:08 web-01 app[1842]: health check passed
```

This log output proves systemd recorded the reload and the application logged a healthy post-update signal. If logs show crashes, config errors, or repeated restarts, stop the window and move to the rollback plan while the evidence is fresh.

These commands form a safety loop. Check the service first, preview the package change, keep a config backup, apply the update, validate syntax, reload carefully, and prove the service still responds.

Some teams enable unattended security updates for low-risk packages and keep manual windows for larger changes. That can work well, but it still needs monitoring. Automatic updates that restart a critical service should be visible in logs and alerts.

## Remove, Roll Back, and Audit Packages
<!-- section-summary: Package management also includes removing unused software, verifying ownership, and investigating change history. -->

After a few release cycles, servers collect leftovers. A Python runtime may remain after the app moved to Node.js. An old helper package may stay installed after a migration. Removing unused packages reduces attack surface and operational noise, and removal still deserves the same preview-and-check habit as installation.

Removal is risky because packages are connected to services, scripts, and other packages. A package may look unused in a package list while a cron job still calls its binary every night. A web service may depend on a library that came along with an older install. The safe sequence is preview, check usage, remove, validate, then audit or roll back if the result is wrong.

Three APT cleanup words are worth separating:

- `remove` uninstalls the package files while usually leaving configuration files behind.
- `purge` removes the package and its package-managed configuration files. Use it after you are sure you do not need that config for recovery.
- `autoremove` removes dependency packages that were installed automatically and are no longer required by installed packages.

Preview the package before removal:

```bash
apt show unused-package

# Example output:
# Package: unused-package
# Version: 1.0-1
# APT-Manual-Installed: yes
# Description: old image conversion helper
```

This output tells you which package APT knows by that name and whether it was manually installed. A manually installed package deserves a usage check before removal because someone explicitly added it at some point.

Check whether service files or scripts mention the package or command name:

```bash
grep -R "unused-package" /etc/systemd/system /etc/cron* /srv/web/scripts 2>/dev/null

# Example output:
# /srv/web/scripts/old-report.sh:unused-package --input report.png
```

This output means a script still calls the tool. The next decision is to update or delete that script before removing the package. An empty result is still only one useful check, so continue with the package preview.

APT removal:

```bash
sudo apt remove unused-package

# Example output:
# The following packages will be REMOVED:
#   unused-package
# 0 upgraded, 0 newly installed, 1 to remove and 0 not upgraded.
# After this operation, 42.0 MB disk space will be freed.
# Do you want to continue? [Y/n]
```

Plain-English reading of this APT preview:

- `REMOVED` lists the packages APT plans to uninstall.
- `1 to remove` confirms the change is narrow.
- The disk-space line tells you the cleanup size.
- The prompt is your pause point. If APT plans to remove important dependencies or many packages, answer `n` and investigate.

Clean up dependencies that no installed package needs:

```bash
sudo apt autoremove

# Example output:
# The following packages will be REMOVED:
#   old-helper-lib old-helper-data
# 0 upgraded, 0 newly installed, 2 to remove and 0 not upgraded.
# Do you want to continue? [Y/n]
```

`autoremove` is useful after removals because it clears packages that only existed as dependencies. Check the list the same way. If it includes a runtime, database client, or library you still recognize from your application, pause and inspect why APT thinks it is unused.

DNF removal:

```bash
sudo dnf remove unused-package

# Example output:
# Dependencies resolved.
# ================================================================================
#  Package             Architecture Version           Repository             Size
# ================================================================================
# Removing:
#  unused-package      x86_64       1.0-1.el9         @appstream             42 M
#
# Transaction Summary
# ================================================================================
# Remove  1 Package
# Is this ok [y/N]:
```

Plain-English reading of this DNF preview:

- `Removing` names the RPM package DNF plans to uninstall.
- `@appstream` means the installed package originally came from the `appstream` repository.
- `Transaction Summary` shows the total removal count.
- The prompt is the same decision point as APT. If DNF adds dependency removals you did not expect, answer `N`.

After removal, validate the service that might have used the package:

```bash
systemctl status app.service

# Example output:
# ● app.service - Web application
#      Active: active (running) since Wed 2026-06-24 10:08:41 UTC; 2min ago
```

```bash
curl --fail --silent --show-error http://127.0.0.1:8080/health

# Example output:
# ok
```

These checks prove the service still runs and answers after the package removal. If either check fails, use the package history and ownership commands below to decide whether to reinstall, restore config, or roll back the release.

Before and after removal, query ownership and installed package lists. A package can look unused because you forgot which service calls its binary. Removing a package that another service still uses can create an avoidable outage.

Rollback and audit start from evidence. Package history tells you what changed. Ownership queries tell you which package placed a binary or config helper on disk. Service checks tell you whether the machine still behaves correctly after the change. Use those three clues together before trying a package downgrade.

Debian-style package audit:

```bash
dpkg -l | grep nginx

# Example output:
# ii  nginx          1.24.0-2ubuntu7.3  amd64  small, powerful, scalable web/proxy server
# ii  nginx-core     1.24.0-2ubuntu7.3  amd64  nginx web/proxy server core
```

Plain-English reading of `dpkg -l` output:

- `ii` means the package is installed and configured.
- The second column is the package name.
- The version column tells you the exact installed version.
- If the first letters show removal or config-only states, the package may have leftovers that need cleanup.

```bash
dpkg -S /usr/sbin/nginx

# Example output:
# nginx-core: /usr/sbin/nginx
```

Plain-English reading of `dpkg -S` output:

- `nginx-core` is the package that owns the file.
- `/usr/sbin/nginx` is the file path you asked about.
- If no package owns the file, it may have been installed outside APT, copied manually, or created by an application.

RPM-style package audit:

```bash
rpm -qa | grep nginx

# Example output:
# nginx-core-1.24.0-4.el9.x86_64
# nginx-filesystem-1.24.0-4.el9.noarch
```

Plain-English reading of `rpm -qa` output:

- Each line is one installed RPM package.
- The name, version, release, and architecture are packed into the package string.
- Filtering with `grep nginx` narrows the full package inventory to packages related to Nginx.

```bash
rpm -qf /usr/sbin/nginx

# Example output:
# nginx-core-1.24.0-4.el9.x86_64
```

Plain-English reading of `rpm -qf` output:

- The output names the RPM package that owns `/usr/sbin/nginx`.
- The version and release identify the installed build.
- If RPM says the file is not owned by any package, investigate manual installs or files created by scripts.

Config files deserve special attention. Package managers may keep local modifications, create `.dpkg-old` or `.dpkg-dist` files, or show prompts during upgrades. After an Nginx package update, compare active config and test it:

```bash
sudo nginx -t

# Example output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

If the audit shows the package changed and the service test fails, choose the smallest recovery path first. That may be restoring a config backup, undoing a DNF transaction, reinstalling the previous package version from an approved repo, or rolling back the application release that depended on the package change.

```bash
sudo systemctl reload nginx
```

Package management stays with the server for its whole life. Every installed package is part of the server's supply chain, patch story, and rollback story.

![Package management summary infographic showing install, update, trust, pinning, rollback, and audit checks](/content-assets/articles/article-devops-foundation-linux-linux-basics-package-management/package-management-summary.png)

_The summary image turns the package-management workflow into a checklist for routine server work._

## References

- [Debian APT user manual](https://www.debian.org/doc/manuals/apt-guide/) - Official Debian guide to APT usage.
- [Ubuntu package management documentation](https://documentation.ubuntu.com/server/how-to/software/package-management/) - Ubuntu server package management guidance.
- [DNF command reference](https://dnf.readthedocs.io/en/latest/command_ref.html) - Official DNF command documentation.
- [RPM manual](https://rpm.org/docs/4.20.x/man/rpm.8.html) - Official RPM command documentation.
- [Nginx Linux packages](https://nginx.org/en/linux_packages.html) - Official Nginx package repository guidance.
- [Debian unattended-upgrades package](https://wiki.debian.org/UnattendedUpgrades) - Debian documentation for automatic security updates.
