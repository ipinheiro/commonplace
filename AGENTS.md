# Git workflow

- Start each new task on a new branch from the latest `origin/develop`, using a prefix that matches the work, such as `feat/`, `fix/`, or `refactor/`.
- Continue follow-up work for the same task on its existing branch.
- Commit and push task work on that branch. Once the user approves it for merging, merge it into `develop`, then merge `develop` into `main`.
