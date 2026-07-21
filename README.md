# Hlásím se

Monorepo pro bezplatnou check-in službu, která upozorní zvolené strážce, když se uživatel neohlásí včas.

## Struktura

- `apps/mobile` — Expo aplikace pro iOS a Android
- `apps/server` — Django web, API a administrační rozhraní
- `docs` — architektura, release kritéria a provozní runbooky

## Vývoj

```bash
npm install
npm test
npm run typecheck
```

Serverové příkazy jsou spravované přes `uv` a Python 3.14.

## Mobilní release gate

Každý mobilní API požadavek posílá nativní platformu, verzi a build. Produkční Django
startuje pouze s explicitními `MOBILE_MIN_IOS_VERSION`, `MOBILE_MIN_ANDROID_VERSION`
a odpovídajícími `MOBILE_MIN_IOS_BUILD`, `MOBILE_MIN_ANDROID_BUILD` spolu se skutečnými
listing URL na `apps.apple.com` a `play.google.com`. `MOBILE_API_MAINTENANCE=true` zastaví app API;
`/health/live/`, `/health/ready/` a veřejný `/api/v1/client-config/` zůstávají dostupné.
Hodnotu minimální verze zvyšujte až po zveřejnění odpovídajícího buildu v obou obchodech.

## Bezpečnostní omezení

Hlásím se nenahrazuje linky 112 ani 155 a push notifikace nelze považovat za garantovaný komunikační kanál. Veřejný release vyžaduje ověřený alert pipeline, monitoring, obnovu záloh a cross-platform testy na fyzických zařízeních.

## Licence

Copyright © 2026 Tomáš Mach. All rights reserved.
