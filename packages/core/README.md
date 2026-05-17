# @dbsketch/core

Library entry point for [dbsketch](https://github.com/jacobmpeters/dbsketch) — compile DBML or SQL DDL into clean ASCII/Unicode ERD diagrams. Browser-safe (no Node-only imports).

```sh
npm install @dbsketch/core
```

```ts
import { compile, compileSql } from '@dbsketch/core';

const ascii = compile(dbmlSource);
const ascii = compileSql(sqlSource, 'postgres');
```

See the [project README](https://github.com/jacobmpeters/dbsketch#readme) for the algorithm, layout hints, and full examples.
