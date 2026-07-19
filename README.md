# Hlásím se

Monorepo pro bezplatnou check-in službu, která upozorní zvolené strážce, když se uživatel neohlásí včas.

## Struktura

- `apps/mobile` — Expo aplikace pro iOS a Android
- `apps/server` — Django web, API a administrační rozhraní
- `archive/supabase` — původní Supabase Edge Functions ponechané pouze pro migrační audit
- `docs` — architektura, release kritéria a provozní runbooky

## Vývoj

```bash
npm install
npm test
npm run typecheck
```

Serverové příkazy jsou spravované přes `uv` a Python 3.14.

## Bezpečnostní omezení

Hlásím se nenahrazuje linky 112 ani 155 a push notifikace nelze považovat za garantovaný komunikační kanál. Veřejný release vyžaduje ověřený alert pipeline, monitoring, obnovu záloh a cross-platform testy na fyzických zařízeních.

## Licence

Copyright © 2026 Tomáš Mach. All rights reserved.
