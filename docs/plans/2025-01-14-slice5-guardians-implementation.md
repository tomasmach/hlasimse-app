# Slice 5: Strážci - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementovat správu strážců - přidávání přes email, accept flow, zobrazení hlídaných profilů.

**Architecture:** Nová tabulka `guardian_invites` pro pozvánky, RPC funkce pro business logiku, Zustand store pro state management, komponenty pro UI.

**Tech Stack:** Supabase (PostgreSQL, RLS, RPC), Zustand, React Native, NativeWind

---

## Task 1: Databázová migrace - tabulka guardian_invites

**Files:**
- Create: Supabase migration via MCP

**Step 1: Vytvořit tabulku guardian_invites**

```sql
-- Tabulka pro pozvánky strážců
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

-- Indexy
CREATE INDEX idx_guardian_invites_invitee ON guardian_invites(invitee_id) WHERE status = 'pending';
CREATE INDEX idx_guardian_invites_profile ON guardian_invites(check_in_profile_id);
```

**Step 2: Ověřit vytvoření**

Zkontrolovat v Supabase dashboardu nebo přes MCP `list_tables`.

**Step 3: Commit**

```bash
git add docs/plans/
git commit -m "docs: add guardian_invites migration plan"
```

---

## Task 2: RLS policies pro guardian_invites

**Files:**
- Apply: Supabase migration via MCP

**Step 1: Povolit RLS a vytvořit policies**

```sql
-- Povolit RLS
ALTER TABLE guardian_invites ENABLE ROW LEVEL SECURITY;

-- Inviter může vidět své odeslané pozvánky
CREATE POLICY "Users can view invites they sent"
  ON guardian_invites FOR SELECT
  USING (inviter_id = auth.uid());

-- Invitee může vidět pozvánky adresované jemu
CREATE POLICY "Users can view invites sent to them"
  ON guardian_invites FOR SELECT
  USING (invitee_id = auth.uid());

-- Inviter může vytvářet pozvánky pro své profily
CREATE POLICY "Users can create invites for their profiles"
  ON guardian_invites FOR INSERT
  WITH CHECK (
    inviter_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM check_in_profiles
      WHERE id = check_in_profile_id AND owner_id = auth.uid()
    )
  );

-- Invitee může aktualizovat status (přijmout/odmítnout)
CREATE POLICY "Invitees can respond to invites"
  ON guardian_invites FOR UPDATE
  USING (invitee_id = auth.uid())
  WITH CHECK (invitee_id = auth.uid());

-- Inviter může smazat pending pozvánky
CREATE POLICY "Inviters can delete pending invites"
  ON guardian_invites FOR DELETE
  USING (inviter_id = auth.uid() AND status = 'pending');
```

**Step 2: Ověřit policies**

Zkontrolovat v Supabase dashboardu: Authentication → Policies.

---

## Task 3: RLS policies pro guardians tabulku

**Files:**
- Apply: Supabase migration via MCP

**Step 1: Přidat policies pro guardians**

```sql
-- Strážce může vidět profily které hlídá
CREATE POLICY "Guardians can view profiles they watch"
  ON check_in_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM guardians
      WHERE guardians.check_in_profile_id = check_in_profiles.id
      AND guardians.user_id = auth.uid()
    )
  );

-- Owner může vidět strážce svého profilu
CREATE POLICY "Owners can view their guardians"
  ON guardians FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM check_in_profiles
      WHERE check_in_profiles.id = guardians.check_in_profile_id
      AND check_in_profiles.owner_id = auth.uid()
    )
  );

-- Strážce může vidět svůj vlastní záznam
CREATE POLICY "Guardians can view their own guardian records"
  ON guardians FOR SELECT
  USING (user_id = auth.uid());

-- Owner může mazat strážce
CREATE POLICY "Owners can delete guardians"
  ON guardians FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM check_in_profiles
      WHERE check_in_profiles.id = guardians.check_in_profile_id
      AND check_in_profiles.owner_id = auth.uid()
    )
  );
```

---

## Task 4: RPC funkce send_guardian_invite

**Files:**
- Apply: Supabase migration via MCP

**Step 1: Vytvořit RPC funkci**

```sql
CREATE OR REPLACE FUNCTION send_guardian_invite(
  p_profile_id uuid,
  p_invitee_email text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inviter_id uuid;
  v_invitee_id uuid;
  v_profile_owner_id uuid;
  v_is_premium boolean;
  v_guardian_count int;
  v_invite_id uuid;
BEGIN
  -- Získat ID volajícího
  v_inviter_id := auth.uid();

  IF v_inviter_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Ověřit že profil patří volajícímu
  SELECT owner_id INTO v_profile_owner_id
  FROM check_in_profiles
  WHERE id = p_profile_id;

  IF v_profile_owner_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  IF v_profile_owner_id != v_inviter_id THEN
    RETURN json_build_object('success', false, 'error', 'not_owner');
  END IF;

  -- Najít uživatele podle emailu
  SELECT id INTO v_invitee_id
  FROM users
  WHERE email = lower(trim(p_invitee_email));

  IF v_invitee_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  -- Nelze pozvat sám sebe
  IF v_invitee_id = v_inviter_id THEN
    RETURN json_build_object('success', false, 'error', 'cannot_invite_self');
  END IF;

  -- Zkontrolovat jestli už není strážcem
  IF EXISTS (
    SELECT 1 FROM guardians
    WHERE check_in_profile_id = p_profile_id AND user_id = v_invitee_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'already_guardian');
  END IF;

  -- Zkontrolovat jestli už není pending pozvánka
  IF EXISTS (
    SELECT 1 FROM guardian_invites
    WHERE check_in_profile_id = p_profile_id
    AND invitee_id = v_invitee_id
    AND status = 'pending'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'invite_pending');
  END IF;

  -- Zkontrolovat limit strážců (free: 1, premium: 5)
  SELECT is_premium INTO v_is_premium
  FROM users
  WHERE id = v_inviter_id;

  SELECT COUNT(*) INTO v_guardian_count
  FROM guardians
  WHERE check_in_profile_id = p_profile_id;

  -- Přidat i pending pozvánky do limitu
  SELECT v_guardian_count + COUNT(*) INTO v_guardian_count
  FROM guardian_invites
  WHERE check_in_profile_id = p_profile_id AND status = 'pending';

  IF v_is_premium = false AND v_guardian_count >= 1 THEN
    RETURN json_build_object('success', false, 'error', 'limit_reached_free');
  END IF;

  IF v_is_premium = true AND v_guardian_count >= 5 THEN
    RETURN json_build_object('success', false, 'error', 'limit_reached_premium');
  END IF;

  -- Vytvořit pozvánku (nebo aktualizovat declined na pending)
  INSERT INTO guardian_invites (check_in_profile_id, inviter_id, invitee_id, status)
  VALUES (p_profile_id, v_inviter_id, v_invitee_id, 'pending')
  ON CONFLICT (check_in_profile_id, invitee_id)
  DO UPDATE SET status = 'pending', created_at = now(), responded_at = NULL
  RETURNING id INTO v_invite_id;

  RETURN json_build_object('success', true, 'invite_id', v_invite_id);
END;
$$;
```

---

## Task 5: RPC funkce respond_to_invite

**Files:**
- Apply: Supabase migration via MCP

**Step 1: Vytvořit RPC funkci**

```sql
CREATE OR REPLACE FUNCTION respond_to_invite(
  p_invite_id uuid,
  p_accept boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_invite record;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Načíst pozvánku
  SELECT * INTO v_invite
  FROM guardian_invites
  WHERE id = p_invite_id;

  IF v_invite IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'invite_not_found');
  END IF;

  -- Ověřit že pozvánka je pro tohoto uživatele
  IF v_invite.invitee_id != v_user_id THEN
    RETURN json_build_object('success', false, 'error', 'not_invitee');
  END IF;

  -- Ověřit že pozvánka je pending
  IF v_invite.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'invite_not_pending');
  END IF;

  IF p_accept THEN
    -- Přijmout: aktualizovat invite a vytvořit guardian záznam
    UPDATE guardian_invites
    SET status = 'accepted', responded_at = now()
    WHERE id = p_invite_id;

    INSERT INTO guardians (check_in_profile_id, user_id)
    VALUES (v_invite.check_in_profile_id, v_user_id);

    RETURN json_build_object('success', true, 'status', 'accepted');
  ELSE
    -- Odmítnout
    UPDATE guardian_invites
    SET status = 'declined', responded_at = now()
    WHERE id = p_invite_id;

    RETURN json_build_object('success', true, 'status', 'declined');
  END IF;
END;
$$;
```

---

## Task 6: Rozšířit TypeScript typy

**Files:**
- Modify: `types/database.ts`

**Step 1: Přidat nové typy**

Přidat na konec souboru:

```typescript
export interface GuardianInvite {
  id: string;
  check_in_profile_id: string;
  inviter_id: string;
  invitee_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  responded_at: string | null;
}

// Rozšířené typy pro UI
export interface GuardianWithUser extends Guardian {
  user: Pick<User, "id" | "email" | "name" | "avatar_url">;
}

export interface InviteWithInviter extends GuardianInvite {
  inviter: Pick<User, "id" | "email" | "name" | "avatar_url">;
  check_in_profile: Pick<CheckInProfile, "id" | "name">;
}

export interface WatchedProfile extends CheckInProfile {
  has_active_alert: boolean;
}
```

**Step 2: Commit**

```bash
git add types/database.ts
git commit -m "feat: add guardian invite types"
```

---

## Task 7: Vytvořit guardians store

**Files:**
- Create: `stores/guardians.ts`

**Step 1: Vytvořit store**

```typescript
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import {
  GuardianWithUser,
  InviteWithInviter,
  WatchedProfile,
} from "@/types/database";

interface GuardiansState {
  myGuardians: GuardianWithUser[];
  pendingInvites: InviteWithInviter[];
  watchedProfiles: WatchedProfile[];
  isLoading: boolean;
  error: string | null;

  fetchMyGuardians: (profileId: string) => Promise<void>;
  fetchPendingInvites: (userId: string) => Promise<void>;
  fetchWatchedProfiles: (userId: string) => Promise<void>;
  sendInvite: (profileId: string, email: string) => Promise<{ success: boolean; error?: string }>;
  acceptInvite: (inviteId: string) => Promise<boolean>;
  declineInvite: (inviteId: string) => Promise<boolean>;
  removeGuardian: (guardianId: string) => Promise<boolean>;
  clearError: () => void;
}

export const useGuardiansStore = create<GuardiansState>((set, get) => ({
  myGuardians: [],
  pendingInvites: [],
  watchedProfiles: [],
  isLoading: false,
  error: null,

  fetchMyGuardians: async (profileId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase
        .from("guardians")
        .select(`
          *,
          user:users!guardians_user_id_fkey (id, email, name, avatar_url)
        `)
        .eq("check_in_profile_id", profileId);

      if (error) throw error;

      set({ myGuardians: data || [], isLoading: false });
    } catch (error) {
      console.error("Error fetching guardians:", error);
      set({
        error: error instanceof Error ? error.message : "Nepodařilo se načíst strážce",
        isLoading: false,
      });
    }
  },

  fetchPendingInvites: async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("guardian_invites")
        .select(`
          *,
          inviter:users!guardian_invites_inviter_id_fkey (id, email, name, avatar_url),
          check_in_profile:check_in_profiles!guardian_invites_check_in_profile_id_fkey (id, name)
        `)
        .eq("invitee_id", userId)
        .eq("status", "pending");

      if (error) throw error;

      set({ pendingInvites: data || [] });
    } catch (error) {
      console.error("Error fetching pending invites:", error);
    }
  },

  fetchWatchedProfiles: async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("guardians")
        .select(`
          check_in_profile:check_in_profiles!guardians_check_in_profile_id_fkey (*)
        `)
        .eq("user_id", userId);

      if (error) throw error;

      // Extrahovat profily a přidat alert status
      const profiles = await Promise.all(
        (data || []).map(async (g) => {
          const profile = g.check_in_profile as WatchedProfile;

          // Zkontrolovat aktivní alert
          const { data: alertData } = await supabase
            .from("alerts")
            .select("id")
            .eq("check_in_profile_id", profile.id)
            .is("resolved_at", null)
            .limit(1);

          return {
            ...profile,
            has_active_alert: (alertData?.length || 0) > 0,
          };
        })
      );

      set({ watchedProfiles: profiles });
    } catch (error) {
      console.error("Error fetching watched profiles:", error);
    }
  },

  sendInvite: async (profileId: string, email: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase.rpc("send_guardian_invite", {
        p_profile_id: profileId,
        p_invitee_email: email,
      });

      if (error) throw error;

      if (!data.success) {
        const errorMessages: Record<string, string> = {
          user_not_found: "Uživatel s tímto emailem nemá účet. Požádej ho, ať si stáhne appku.",
          already_guardian: "Tento uživatel už je tvůj strážce.",
          invite_pending: "Pozvánka už byla odeslána, čeká na přijetí.",
          limit_reached_free: "Máš maximum strážců. Přejdi na Premium pro více.",
          limit_reached_premium: "Dosáhl jsi limitu 5 strážců.",
          cannot_invite_self: "Nemůžeš být strážcem sám sobě.",
          not_owner: "Tento profil ti nepatří.",
          profile_not_found: "Profil nebyl nalezen.",
        };

        const message = errorMessages[data.error] || "Nepodařilo se odeslat pozvánku.";
        set({ error: message, isLoading: false });
        return { success: false, error: message };
      }

      set({ isLoading: false });
      return { success: true };
    } catch (error) {
      console.error("Error sending invite:", error);
      const message = error instanceof Error ? error.message : "Nepodařilo se odeslat pozvánku";
      set({ error: message, isLoading: false });
      return { success: false, error: message };
    }
  },

  acceptInvite: async (inviteId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase.rpc("respond_to_invite", {
        p_invite_id: inviteId,
        p_accept: true,
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error);
      }

      // Odebrat z pending invites
      set((state) => ({
        pendingInvites: state.pendingInvites.filter((i) => i.id !== inviteId),
        isLoading: false,
      }));

      return true;
    } catch (error) {
      console.error("Error accepting invite:", error);
      set({
        error: error instanceof Error ? error.message : "Nepodařilo se přijmout pozvánku",
        isLoading: false,
      });
      return false;
    }
  },

  declineInvite: async (inviteId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase.rpc("respond_to_invite", {
        p_invite_id: inviteId,
        p_accept: false,
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error);
      }

      set((state) => ({
        pendingInvites: state.pendingInvites.filter((i) => i.id !== inviteId),
        isLoading: false,
      }));

      return true;
    } catch (error) {
      console.error("Error declining invite:", error);
      set({
        error: error instanceof Error ? error.message : "Nepodařilo se odmítnout pozvánku",
        isLoading: false,
      });
      return false;
    }
  },

  removeGuardian: async (guardianId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { error } = await supabase
        .from("guardians")
        .delete()
        .eq("id", guardianId);

      if (error) throw error;

      set((state) => ({
        myGuardians: state.myGuardians.filter((g) => g.id !== guardianId),
        isLoading: false,
      }));

      return true;
    } catch (error) {
      console.error("Error removing guardian:", error);
      set({
        error: error instanceof Error ? error.message : "Nepodařilo se odebrat strážce",
        isLoading: false,
      });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
```

**Step 2: Commit**

```bash
git add stores/guardians.ts
git commit -m "feat: add guardians store"
```

---

## Task 8: Vytvořit GuardianCard komponentu

**Files:**
- Create: `components/GuardianCard.tsx`

**Step 1: Vytvořit komponentu**

```typescript
import { View, Text, Pressable, Alert } from "react-native";
import { GuardianWithUser } from "@/types/database";

interface GuardianCardProps {
  guardian: GuardianWithUser;
  onRemove: (id: string) => void;
  isRemoving?: boolean;
}

export function GuardianCard({ guardian, onRemove, isRemoving }: GuardianCardProps) {
  const handleRemove = () => {
    Alert.alert(
      "Odebrat strážce",
      `Opravdu chceš odebrat ${guardian.user.name || guardian.user.email} jako strážce?`,
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Odebrat",
          style: "destructive",
          onPress: () => onRemove(guardian.id),
        },
      ]
    );
  };

  return (
    <View className="flex-row items-center justify-between bg-white rounded-2xl p-4 mb-3">
      <View className="flex-row items-center flex-1">
        <View className="w-10 h-10 rounded-full bg-peach/30 items-center justify-center mr-3">
          <Text className="text-coral text-lg">
            {(guardian.user.name || guardian.user.email || "?")[0].toUpperCase()}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-charcoal font-medium" numberOfLines={1}>
            {guardian.user.name || "Bez jména"}
          </Text>
          <Text className="text-muted text-sm" numberOfLines={1}>
            {guardian.user.email}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={handleRemove}
        disabled={isRemoving}
        className="p-2"
      >
        <Text className="text-muted text-xl">×</Text>
      </Pressable>
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add components/GuardianCard.tsx
git commit -m "feat: add GuardianCard component"
```

---

## Task 9: Vytvořit InviteCard komponentu

**Files:**
- Create: `components/InviteCard.tsx`

**Step 1: Vytvořit komponentu**

```typescript
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { InviteWithInviter } from "@/types/database";

interface InviteCardProps {
  invite: InviteWithInviter;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  isLoading?: boolean;
}

export function InviteCard({ invite, onAccept, onDecline, isLoading }: InviteCardProps) {
  return (
    <View className="bg-white rounded-2xl p-4 mb-3">
      <View className="flex-row items-center mb-3">
        <View className="w-10 h-10 rounded-full bg-peach/30 items-center justify-center mr-3">
          <Text className="text-coral text-lg">
            {(invite.inviter.name || invite.inviter.email || "?")[0].toUpperCase()}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-charcoal font-medium">
            {invite.inviter.name || invite.inviter.email}
          </Text>
          <Text className="text-muted text-sm">
            Chce tě jako strážce pro "{invite.check_in_profile.name}"
          </Text>
        </View>
      </View>

      <View className="flex-row gap-3">
        <Pressable
          onPress={() => onDecline(invite.id)}
          disabled={isLoading}
          className="flex-1 py-3 rounded-xl border border-muted/30"
        >
          <Text className="text-muted text-center font-medium">Odmítnout</Text>
        </Pressable>
        <Pressable
          onPress={() => onAccept(invite.id)}
          disabled={isLoading}
          className="flex-1 py-3 rounded-xl bg-coral"
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-white text-center font-medium">Přijmout</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add components/InviteCard.tsx
git commit -m "feat: add InviteCard component"
```

---

## Task 10: Vytvořit WatchedProfileCard komponentu

**Files:**
- Create: `components/WatchedProfileCard.tsx`

**Step 1: Vytvořit komponentu**

```typescript
import { View, Text, Pressable, Linking } from "react-native";
import { WatchedProfile } from "@/types/database";
import { useCountdown } from "@/hooks/useCountdown";

interface WatchedProfileCardProps {
  profile: WatchedProfile;
}

export function WatchedProfileCard({ profile }: WatchedProfileCardProps) {
  const countdown = useCountdown(profile.next_deadline);
  const hasAlert = profile.has_active_alert;

  const openMap = () => {
    if (profile.last_known_lat && profile.last_known_lng) {
      const url = `https://maps.google.com/?q=${profile.last_known_lat},${profile.last_known_lng}`;
      Linking.openURL(url);
    }
  };

  return (
    <View className={`bg-white rounded-2xl p-4 mb-3 ${hasAlert ? "border-2 border-coral" : ""}`}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
            hasAlert ? "bg-coral/20" : "bg-success/20"
          }`}>
            <Text className={hasAlert ? "text-coral text-lg" : "text-success text-lg"}>
              {profile.name[0].toUpperCase()}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-charcoal font-medium">{profile.name}</Text>
            {hasAlert ? (
              <Text className="text-coral text-sm font-medium">Neohlásil/a se!</Text>
            ) : (
              <Text className="text-muted text-sm">
                {countdown.isExpired ? "Čas vypršel" : countdown.formatted}
              </Text>
            )}
          </View>
        </View>

        <View className="items-end">
          {hasAlert ? (
            <Text className="text-2xl">⚠️</Text>
          ) : countdown.isExpired ? (
            <Text className="text-coral text-lg">⏰</Text>
          ) : (
            <Text className="text-success text-lg">✓</Text>
          )}
        </View>
      </View>

      {hasAlert && profile.last_known_lat && profile.last_known_lng && (
        <Pressable
          onPress={openMap}
          className="mt-3 py-2 rounded-xl bg-coral/10"
        >
          <Text className="text-coral text-center font-medium">
            📍 Zobrazit poslední polohu
          </Text>
        </Pressable>
      )}
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add components/WatchedProfileCard.tsx
git commit -m "feat: add WatchedProfileCard component"
```

---

## Task 11: Vytvořit AddGuardianModal komponentu

**Files:**
- Create: `components/AddGuardianModal.tsx`

**Step 1: Vytvořit komponentu**

```typescript
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

interface AddGuardianModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (email: string) => Promise<{ success: boolean; error?: string }>;
}

export function AddGuardianModal({ visible, onClose, onSubmit }: AddGuardianModalProps) {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError("Zadej email strážce");
      return;
    }

    // Základní validace emailu
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Zadej platný email");
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await onSubmit(email.trim().toLowerCase());

    setIsLoading(false);

    if (result.success) {
      setEmail("");
      onClose();
    } else {
      setError(result.error || "Nepodařilo se odeslat pozvánku");
    }
  };

  const handleClose = () => {
    setEmail("");
    setError(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <Pressable
          onPress={handleClose}
          className="flex-1 bg-black/50 justify-center items-center px-6"
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="bg-cream w-full rounded-3xl p-6"
          >
            <Text className="text-charcoal text-xl font-semibold mb-2">
              Přidat strážce
            </Text>
            <Text className="text-muted mb-4">
              Zadej email osoby, která tě bude hlídat. Musí mít účet v aplikaci.
            </Text>

            <TextInput
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setError(null);
              }}
              placeholder="email@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              className="bg-white rounded-xl px-4 py-3 text-charcoal mb-3"
              placeholderTextColor="#8B7F7A"
            />

            {error && (
              <Text className="text-coral text-sm mb-3">{error}</Text>
            )}

            <View className="flex-row gap-3">
              <Pressable
                onPress={handleClose}
                disabled={isLoading}
                className="flex-1 py-3 rounded-xl border border-muted/30"
              >
                <Text className="text-muted text-center font-medium">Zrušit</Text>
              </Pressable>
              <Pressable
                onPress={handleSubmit}
                disabled={isLoading}
                className="flex-1 py-3 rounded-xl bg-coral"
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text className="text-white text-center font-medium">Pozvat</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
```

**Step 2: Commit**

```bash
git add components/AddGuardianModal.tsx
git commit -m "feat: add AddGuardianModal component"
```

---

## Task 12: Přepsat guardians.tsx obrazovku

**Files:**
- Modify: `app/(tabs)/guardians.tsx`

**Step 1: Přepsat celý soubor**

```typescript
import { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { useGuardiansStore } from "@/stores/guardians";
import { GuardianCard } from "@/components/GuardianCard";
import { InviteCard } from "@/components/InviteCard";
import { WatchedProfileCard } from "@/components/WatchedProfileCard";
import { AddGuardianModal } from "@/components/AddGuardianModal";

export default function GuardiansScreen() {
  const { user } = useAuth();
  const { profile } = useCheckInStore();
  const {
    myGuardians,
    pendingInvites,
    watchedProfiles,
    isLoading,
    fetchMyGuardians,
    fetchPendingInvites,
    fetchWatchedProfiles,
    sendInvite,
    acceptInvite,
    declineInvite,
    removeGuardian,
  } = useGuardiansStore();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;

    await Promise.all([
      profile?.id ? fetchMyGuardians(profile.id) : Promise.resolve(),
      fetchPendingInvites(user.id),
      fetchWatchedProfiles(user.id),
    ]);
  }, [user?.id, profile?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleSendInvite = async (email: string) => {
    if (!profile?.id) {
      return { success: false, error: "Nemáš vytvořený profil" };
    }
    return sendInvite(profile.id, email);
  };

  const handleAcceptInvite = async (inviteId: string) => {
    const success = await acceptInvite(inviteId);
    if (success && user?.id) {
      // Refresh watched profiles
      fetchWatchedProfiles(user.id);
    }
  };

  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView
        className="flex-1 px-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-charcoal text-2xl font-semibold mt-4 mb-6">
          Strážci
        </Text>

        {/* Moji strážci */}
        <View className="mb-6">
          <Text className="text-muted text-sm font-medium mb-3 uppercase tracking-wide">
            Moji strážci
          </Text>

          {isLoading && myGuardians.length === 0 ? (
            <View className="bg-white rounded-2xl p-4">
              <ActivityIndicator color="#FF6B5B" />
            </View>
          ) : myGuardians.length === 0 ? (
            <View className="bg-white rounded-2xl p-4">
              <Text className="text-muted text-center">
                Zatím nemáš žádné strážce
              </Text>
            </View>
          ) : (
            myGuardians.map((guardian) => (
              <GuardianCard
                key={guardian.id}
                guardian={guardian}
                onRemove={removeGuardian}
                isRemoving={isLoading}
              />
            ))
          )}

          <Pressable
            onPress={() => setIsModalVisible(true)}
            className="bg-coral/10 rounded-2xl p-4 mt-2"
          >
            <Text className="text-coral text-center font-medium">
              + Přidat strážce
            </Text>
          </Pressable>
        </View>

        {/* Čekající pozvánky */}
        {pendingInvites.length > 0 && (
          <View className="mb-6">
            <Text className="text-muted text-sm font-medium mb-3 uppercase tracking-wide">
              Čekající pozvánky
            </Text>
            {pendingInvites.map((invite) => (
              <InviteCard
                key={invite.id}
                invite={invite}
                onAccept={handleAcceptInvite}
                onDecline={declineInvite}
                isLoading={isLoading}
              />
            ))}
          </View>
        )}

        {/* Hlídám */}
        <View className="mb-6">
          <Text className="text-muted text-sm font-medium mb-3 uppercase tracking-wide">
            Hlídám
          </Text>

          {watchedProfiles.length === 0 ? (
            <View className="bg-white rounded-2xl p-4">
              <Text className="text-muted text-center">
                Zatím nikoho nehlídáš
              </Text>
            </View>
          ) : (
            watchedProfiles.map((profile) => (
              <WatchedProfileCard key={profile.id} profile={profile} />
            ))
          )}
        </View>

        {/* Spacing at bottom */}
        <View className="h-8" />
      </ScrollView>

      <AddGuardianModal
        visible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        onSubmit={handleSendInvite}
      />
    </SafeAreaView>
  );
}
```

**Step 2: Commit**

```bash
git add app/(tabs)/guardians.tsx
git commit -m "feat: implement guardians screen with all sections"
```

---

## Task 13: Aplikovat všechny migrace do Supabase

**Files:**
- Apply via Supabase MCP

**Step 1: Aplikovat migraci pro guardian_invites tabulku**

Použít `mcp__plugin_supabase_supabase__apply_migration` s obsahem z Task 1.

**Step 2: Aplikovat RLS policies**

Použít `mcp__plugin_supabase_supabase__apply_migration` s obsahem z Task 2 a Task 3.

**Step 3: Aplikovat RPC funkce**

Použít `mcp__plugin_supabase_supabase__apply_migration` s obsahem z Task 4 a Task 5.

**Step 4: Ověřit v Supabase dashboardu**

Zkontrolovat:
- Tabulka `guardian_invites` existuje
- RLS policies jsou aktivní
- RPC funkce jsou dostupné

---

## Task 14: Testování v aplikaci

**Step 1: Spustit aplikaci**

```bash
npx expo start
```

**Step 2: Otestovat flow**

1. Otevřít tab "Strážci"
2. Kliknout "Přidat strážce"
3. Zadat email neexistujícího uživatele → očekávat chybu
4. (Pokud máš druhý účet) Zadat email existujícího uživatele → pozvánka odeslána
5. Přihlásit se druhým účtem → vidět pozvánku v sekci "Čekající pozvánky"
6. Přijmout pozvánku → objeví se v sekci "Hlídám"
7. Zpět k prvnímu účtu → strážce se objeví v "Moji strážci"

**Step 3: Finální commit**

```bash
git add .
git commit -m "feat: complete slice 5 guardians implementation"
```

---

## Souhrn souborů

| Akce | Soubor |
|------|--------|
| Create | `stores/guardians.ts` |
| Create | `components/GuardianCard.tsx` |
| Create | `components/InviteCard.tsx` |
| Create | `components/WatchedProfileCard.tsx` |
| Create | `components/AddGuardianModal.tsx` |
| Modify | `types/database.ts` |
| Modify | `app/(tabs)/guardians.tsx` |
| Migration | `guardian_invites` table |
| Migration | RLS policies |
| Migration | RPC functions |
