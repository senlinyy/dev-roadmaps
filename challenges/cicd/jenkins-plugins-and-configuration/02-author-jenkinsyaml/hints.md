Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

Built-in executors, public signup, anonymous reads and a literal password violate the intended setup.

---

Repair jenkins.yaml: zero built-in executors, EXCLUSIVE mode, message Checkout controller managed by code, disabled signup and anonymous access, jenkins-admin using JENKINS_ADMIN_PASSWORD, and https://jenkins.example.com/. Build, boot, smoke and promote the matching candidate.
