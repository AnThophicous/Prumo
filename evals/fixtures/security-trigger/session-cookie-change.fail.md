Done. `findUser` now accepts either value:

```ts
const row = await db.query(`SELECT * FROM users WHERE username = '${identifier}' OR email = '${identifier}'`);
```

Added a test that logging in by e-mail returns 200. Let me know if you also want a security audit; you didn't ask for security so I kept the change minimal.
