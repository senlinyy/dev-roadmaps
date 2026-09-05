```bash
dig @10.20.0.53 app.example.com A
dig @192.0.2.53 app.example.com A
sleep 60
dig @10.20.0.53 app.example.com A
```

The cached copy retains its old expiry. After expiry, a fresh recursive lookup retrieves current source data.

