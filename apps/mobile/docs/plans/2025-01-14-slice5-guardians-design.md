# Slice 5: Strážci - Design

## Přehled

Implementace správy strážců - uživatelé mohou přidávat strážce ke svému profilu a zároveň vidět profily, které sami hlídají.

## Rozhodnutí

| Téma | Rozhodnutí |
|------|------------|
| Přidání strážce | Přes email |
| Strážce bez účtu | Musí mít účet (chyba pokud nemá) |
| Accept flow | Ano, strážce musí pozvánku přijmout |
| UI struktura | Jeden tab "Strážci" se sekcemi |
| Poloha hlídaného | Zobrazit jen při alertu (neohlásil se) |

## Datový model

### Nová tabulka `guardian_invites`

```sql
CREATE TABLE guardian_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_profile_id uuid NOT NULL REFERENCES check_in_profiles(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE(check_in_profile_id, invitee_id)
);
```

### Flow

1. Uživatel zadá email → najde se `invitee_id` v `users`
2. Vytvoří se `guardian_invites` se statusem `pending`
3. Strážce přijme → status = `accepted`, vytvoří se záznam v `guardians`
4. Strážce odmítne → status = `declined`

## UI komponenty

### Tab "Strážci" - struktura

```
┌────────────────────────────────────┐
│  Strážci                           │
├────────────────────────────────────┤
│                                    │
│  MOJI STRÁŽCI                      │
│  ┌──────────────────────────────┐  │
│  │ 👤 Jana Nováková      ✓ ⋮   │  │
│  │ 👤 Petr Svoboda       ✓ ⋮   │  │
│  └──────────────────────────────┘  │
│  [ + Přidat strážce ]              │
│                                    │
│  ČEKAJÍCÍ POZVÁNKY (pokud jsou)    │
│  ┌──────────────────────────────┐  │
│  │ 👤 Od: Marie K.              │  │
│  │ Chce tě jako strážce         │  │
│  │ [Přijmout]  [Odmítnout]      │  │
│  └──────────────────────────────┘  │
│                                    │
│  HLÍDÁM                            │
│  ┌──────────────────────────────┐  │
│  │ 👤 Mamka        ✅ 23:45:12  │  │
│  │ 👤 Babička      ⚠️ Neohlásila│  │
│  │                 📍 Zobrazit  │  │
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

### Komponenty

- `GuardianCard` - zobrazení strážce s možností odebrání
- `InviteCard` - pending pozvánka s akcemi přijmout/odmítnout
- `WatchedProfileCard` - hlídaný profil se stavem a countdownem
- `AddGuardianModal` - modal pro zadání emailu

## API a business logika

### Zustand store `stores/guardians.ts`

```typescript
interface GuardiansState {
  // Stav
  myGuardians: Guardian[];
  pendingInvites: Invite[];
  watchedProfiles: WatchedProfile[];
  isLoading: boolean;
  error: string | null;

  // Akce
  fetchMyGuardians: (profileId: string) => Promise<void>;
  fetchPendingInvites: (userId: string) => Promise<void>;
  fetchWatchedProfiles: (userId: string) => Promise<void>;
  sendInvite: (profileId: string, email: string) => Promise<boolean>;
  acceptInvite: (inviteId: string) => Promise<boolean>;
  declineInvite: (inviteId: string) => Promise<boolean>;
  removeGuardian: (guardianId: string) => Promise<boolean>;
}
```

### Supabase RPC funkce

1. `send_guardian_invite(profile_id, invitee_email)`
   - Najde uživatele podle emailu
   - Ověří limity (free: 1 strážce, premium: 5)
   - Vytvoří invite nebo vrátí chybu

2. `respond_to_invite(invite_id, accept)`
   - Aktualizuje status
   - Pokud accept → vytvoří záznam v `guardians`

## Error handling

| Situace | Zpráva uživateli |
|---------|------------------|
| Email nenalezen | "Uživatel s tímto emailem nemá účet. Požádej ho, ať si stáhne appku." |
| Už je strážcem | "Tento uživatel už je tvůj strážce." |
| Pending pozvánka existuje | "Pozvánka už byla odeslána, čeká na přijetí." |
| Limit dosažen (free) | "Máš maximum strážců. Přejdi na Premium pro více." |
| Zvaní sám sebe | "Nemůžeš být strážcem sám sobě." |

## Edge cases

1. **Strážce si smaže účet** → CASCADE delete v DB
2. **Hlídaný si smaže profil** → CASCADE delete
3. **Pozvánka expiruje** → Pro MVP ne, zůstává pending
4. **Strážce mě chce odebrat** → Nelze, jen hlídaný může odebrat strážce

## Implementační plán

### Pořadí

1. Databáze - migrace, RLS, RPC funkce
2. Store - `stores/guardians.ts`
3. Komponenty - karty a modal
4. Obrazovka - přepsat `guardians.tsx`
5. Propojení - fetch, realtime subscriptions

### Soubory

```
├── supabase/migrations/
│   └── XXXX_guardian_invites.sql
├── stores/
│   └── guardians.ts (nový)
├── components/
│   ├── GuardianCard.tsx (nový)
│   ├── InviteCard.tsx (nový)
│   ├── WatchedProfileCard.tsx (nový)
│   └── AddGuardianModal.tsx (nový)
├── app/(tabs)/
│   └── guardians.tsx (přepsat)
└── types/
    └── database.ts (rozšířit)
```

### Realtime

Subscription na `guardian_invites` pro okamžité zobrazení nových pozvánek.
