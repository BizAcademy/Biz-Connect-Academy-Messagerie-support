---
name: ORM test isolation
description: Preserve query predicates when wrapping Sequelize methods in isolated capacity tests.
---
Test wrappers around Sequelize query methods must preserve the complete original
predicate, preferably by adding a restriction with `Op.and`, never by replacing
an existing primary-key condition.

**Why:** Sequelize's `findByPk` and `findOne` internally delegate to `findAll`.
A wrapper intended to isolate bootstrap queries can accidentally change all
authorization lookups and report false access failures under load.

**How to apply:** use a dedicated test app process and fixture-scoped predicates;
drain outstanding operations before deleting fixtures, so cleanup cannot race
with pending message transactions.
