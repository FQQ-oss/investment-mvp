# Multi-tenant application structure

```text
investment_mvp/
├── server.mjs              # HTTP entrypoint and API composition
├── rules.mjs               # market rule profiles
├── start.ps1
├── src/
│   ├── auth/                # registration, login, sessions
│   ├── tenants/             # tenant/user isolation
│   ├── market-data/         # Tushare adapters and normalization
│   ├── trading/             # order validation, matching, ledger
│   ├── research/            # Agent analysis and decision cards
│   └── evaluation/          # replay and metrics
├── data/
│   └── tenants/
│       └── {userId}/
│           ├── account.json
│           └── research/decisions.json
└── web/                     # user-facing pages
```

The server is currently being migrated from the original single-user prototype into this tenant-scoped layout. New registrations already receive their own tenant directory and account file. Decision cards now resolve through the logged-in session and are stored under that tenant's `research` directory.
