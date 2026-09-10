Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

The current workflow deploys every build. User intent, branch identity, and change-request context are not separate gates.

---

Declare DEPLOY as a Boolean defaulting to false and TARGET_ENV defaulting to staging. Validate and build every case. Transfer the built application to a trusted release stage only for main, outside a change request, when DEPLOY is true.
