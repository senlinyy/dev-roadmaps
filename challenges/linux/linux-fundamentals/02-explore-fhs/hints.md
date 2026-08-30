System-wide configuration normally begins under `/etc`; look for a directory named after the service.

---

Changing logs belong under `/var/log`, while deployed service data commonly belongs under `/srv`.

---

Short-lived PID files belong under `/run`. Use a command that prints file contents, and use the end-of-file viewer for the two newest log lines.
