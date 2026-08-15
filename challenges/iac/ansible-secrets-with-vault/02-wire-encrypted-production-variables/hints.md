1. Load the Vault file through `vars_files` on the play.
2. Reference the variable with Jinja syntax in the Authorization header.
3. Set `no_log: true` on the task that handles the secret response.
