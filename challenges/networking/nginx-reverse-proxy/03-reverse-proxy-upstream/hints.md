The backend is healthy — the clue is that it expects `/users`, but the failed capture shows the app receiving `/api/users`. Look closely at the `proxy_pass` trailing-slash behavior.
