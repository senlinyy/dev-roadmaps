Use a local `[Service]` drop-in. List-valued directives can be cleared with an empty assignment before adding their replacement.

---

Reloading manager definitions leaves the existing process environment unchanged. Use the main PID from `show` to inspect the replacement process under `/proc`.
