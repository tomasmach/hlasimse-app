# Slice 4: Check-in Logic - Design Document

> Vytvořeno: 2026-01-14

## Přehled

Rozšíření check-in funkcionality o GPS polohu, offline podporu a backend tracking prošlých deadlines.

## Rozhodnutí z brainstormingu

| Téma | Rozhodnutí |
|------|------------|
| GPS poloha | Při check-inu (ne background tracking) |
| Bez GPS oprávnění | Check-in projde + jemný banner s výzvou k povolení |
| Offline | Uložit lokálně, sync později, explicitní feedback |
| Deadline tracking | Edge Function + Cron |
| Frekvence kontroly | Každých 5 minut |

---

## 1. GPS při check-inu

### Hook `useLocation.ts`

```typescript
interface UseLocationResult {
  permissionStatus: 'granted' | 'denied' | 'undetermined' | null;
  requestPermission: () => Promise<boolean>;
  getCurrentPosition: (timeout?: number) => Promise<{lat: number, lng: number} | null>;
}
```

### Chování

1. Před odesláním check-inu zavoláme `getCurrentPosition()` s timeout 5 sekund
2. Pokud GPS nestihne nebo není povoleno → pokračujeme s `lat/lng = null`
3. Polohu uložíme do:
   - `check_ins` tabulky (sloupce `lat`, `lng`)
   - `check_in_profiles.last_known_lat/lng`

### UI

- Pokud `permissionStatus === 'denied'`, zobrazíme banner na hlavní obrazovce:
  - "Pro větší bezpečí povolte přístup k poloze"
  - Tlačítko "Povolit" → otevře systémové nastavení

---

## 2. Offline podpora

### Soubor `lib/offlineQueue.ts`

```typescript
interface PendingCheckIn {
  id: string;
  profileId: string;
  checkedInAt: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

interface OfflineQueue {
  addToQueue: (checkIn: PendingCheckIn) => Promise<void>;
  getQueue: () => Promise<PendingCheckIn[]>;
  removeFromQueue: (id: string) => Promise<void>;
  syncAll: () => Promise<SyncResult>;
}
```

### Flow

1. **Při check-inu:**
   - Zkusíme odeslat na server
   - Pokud síť selže → uložíme do AsyncStorage queue
   - Zobrazíme: "Uloženo, odešleme až budete online"
   - Countdown se resetuje okamžitě (optimisticky lokálně)

2. **Sync mechanismus:**
   - Při startu aplikace: zkontrolujeme queue a sync
   - NetInfo listener: při obnovení spojení → sync
   - Odešleme pending check-iny chronologicky

3. **Server handling:**
   - RPC `atomic_check_in` přijme `checked_in_at` z minulosti
   - Přepočítá `next_deadline` od původního času check-inu

### UI Feedback

| Stav | Zpráva |
|------|--------|
| Offline check-in | "Uloženo, odešleme až budete online" |
| Sync úspěch | Tiše (volitelně malý toast) |
| Sync selhání | Banner s "Zkusit znovu" tlačítkem |
| Pending items | Badge/indikátor počtu nesynced |

---

## 3. Edge Function pro deadline tracking

### Soubor `supabase/functions/check-deadlines/index.ts`

### Spouštění

- Supabase Cron každých 5 minut
- Konfigurace v `supabase/config.toml` nebo Dashboard

### Logika

```sql
SELECT * FROM check_in_profiles
WHERE next_deadline < NOW()
  AND is_active = true
  AND is_paused = false
  AND id NOT IN (
    SELECT check_in_profile_id FROM alerts
    WHERE resolved_at IS NULL
  )
```

Pro každý prošlý profil:
1. Vytvoř záznam v `alerts` tabulce
2. Načti strážce z `guardians` tabulky
3. Ulož `notified_guardians` array do alertu
4. (Slice 6: odešli push notifikace)

### Alert struktura

```typescript
{
  check_in_profile_id: string,
  triggered_at: string,      // ISO timestamp
  resolved_at: null,         // vyplní se při dalším check-inu
  alert_type: 'push',
  notified_guardians: string[] // array guardian user IDs
}
```

### Deduplikace

- Nekontrolujeme profily s aktivním alertem (`resolved_at IS NULL`)
- Předejdeme opakovanému alertování při každém běhu cronu

### Auto-resolve alertu

Při úspěšném check-inu (v `atomic_check_in` RPC):
```sql
UPDATE alerts
SET resolved_at = NOW()
WHERE check_in_profile_id = $1
  AND resolved_at IS NULL
```

---

## 4. Souhrn změn

### Nové soubory

| Soubor | Popis |
|--------|-------|
| `hooks/useLocation.ts` | GPS permission + getCurrentPosition |
| `lib/offlineQueue.ts` | AsyncStorage queue + sync mechanismus |
| `supabase/functions/check-deadlines/index.ts` | Edge Function pro deadline tracking |

### Upravené soubory

| Soubor | Změny |
|--------|-------|
| `stores/checkin.ts` | Přidat GPS polohu + offline logiku |
| `app/(tabs)/index.tsx` | GPS banner + offline feedback UI |
| `docs/migrations/` | Auto-resolve alert při check-inu |

### Závislosti

```bash
npx expo install @react-native-community/netinfo
```

(`expo-location` již nainstalováno)

---

## 5. Testovací scénáře

1. **GPS povoleno:** Check-in uloží polohu
2. **GPS zamítnuto:** Check-in projde, zobrazí se banner
3. **Offline check-in:** Uloží se lokálně, zobrazí feedback
4. **Návrat online:** Automatický sync pending check-inů
5. **Prošlý deadline:** Edge Function vytvoří alert
6. **Check-in po alertu:** Alert se auto-resolvne

---

## Další kroky

Po schválení tohoto designu:
1. Vytvořit implementační plán s konkrétními kroky
2. Implementovat pomocí `superpowers:executing-plans`
