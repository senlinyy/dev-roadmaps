```bash
dig missing.example.com A
dig mail.example.com A
dig app.example.com A
dig mail.example.com MX
dig @192.0.2.53 app.example.com A
```

NXDOMAIN names an absent owner; empty NOERROR can mean an absent type. SERVFAIL is a failed lookup, not proof of a missing name.

