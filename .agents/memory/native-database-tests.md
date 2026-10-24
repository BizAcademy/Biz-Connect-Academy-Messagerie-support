---
name: Native database tests
description: Limits of local MariaDB verification in the command-runner environment.
---

Native MariaDB initialization may be aborted by the command runner while resolving
an `openat` directory descriptor of `-1` (`/proc/.../fd/-1`). Disabling native AIO
does not avoid the failure. This occurs before application database operations.

**Why:** A disposable MariaDB verification encountered the runner's filesystem
tracing error, rather than a SQL or application exception. Preloading a Nix-built
compatibility library into host Node/shell processes also conflicts with glibc
versions; do not pursue that as an application fix.

**How to apply:** Distinguish adapter/build/startup checks from real-database
integration tests. Run full MariaDB integration on a compatible host or CI and
use the private Plesk diagnostic for actual hosting connectivity. Do not describe
successful build or no-database tests as proof that MySQL queries ran successfully.
