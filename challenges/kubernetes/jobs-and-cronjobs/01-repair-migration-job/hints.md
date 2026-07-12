Create the Job-level retry, deadline, and cleanup fields beside `template`. Build the command and argument arrays on the migration container.

---

A Job Pod must use `Never` or `OnFailure`, not the restart contract used by a continuously running service.
