```bash
dig +trace app.example.com A
dig +trace api.stage.example.com A
dig @192.0.2.54 api.stage.example.com A
```

The parent referral still points at the old staging server. A working direct query proves the intended authority has data; it does not repair delegation.

