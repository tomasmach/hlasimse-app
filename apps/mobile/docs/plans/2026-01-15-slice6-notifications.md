# Slice 6: Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement push notifications for guardians when a check-in profile misses its deadline.

**Architecture:**
- App registers device push tokens on init and stores them in `push_tokens` table
- Edge Function `check-deadlines` sends push notifications via Expo Push API when creating alerts
- App handles incoming notifications and deep links to guardian screen

**Tech Stack:** expo-notifications, Expo Push API, Supabase Edge Functions

---

## Task 1: Install expo-notifications

**Files:**
- Modify: `package.json`
- Modify: `app.json`

**Step 1: Install expo-notifications package**

Run:
```bash
npx expo install expo-notifications expo-device expo-constants
```

Expected: Package added to package.json

**Step 2: Configure app.json plugins**

Edit `app.json` - add expo-notifications plugin:

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      "expo-secure-store",
      [
        "expo-notifications",
        {
          "icon": "./assets/images/icon.png",
          "color": "#FF6B5B"
        }
      ]
    ]
  }
}
```

**Step 3: Add iOS notification permission description**

Edit `app.json` - add to ios section:

```json
{
  "expo": {
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.anonymous.hlasimse",
      "infoPlist": {
        "NSUserNotificationsUsageDescription": "Potřebujeme oprávnění k notifikacím, abychom vás mohli upozornit, když se někdo neohlásí včas."
      }
    }
  }
}
```

**Step 4: Commit**

```bash
git add package.json app.json package-lock.json
git commit -m "$(cat <<'EOF'
feat: add expo-notifications package and configuration
EOF
)"
```

---

## Task 2: Create useNotifications hook

**Files:**
- Create: `hooks/useNotifications.ts`

**Step 1: Create the hook file**

Create `hooks/useNotifications.ts`:

```typescript
import { useState, useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import Constants from "expo-constants";

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface UseNotificationsResult {
  expoPushToken: string | null;
  permissionStatus: Notifications.PermissionStatus | null;
  notification: Notifications.Notification | null;
  requestPermissions: () => Promise<boolean>;
  registerToken: (userId: string) => Promise<void>;
}

export function useNotifications(): UseNotificationsResult {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] =
    useState<Notifications.PermissionStatus | null>(null);
  const [notification, setNotification] =
    useState<Notifications.Notification | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // Check current permission status on mount
    Notifications.getPermissionsAsync().then(({ status }) => {
      setPermissionStatus(status);
    });

    // Listen for incoming notifications
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        setNotification(notification);
      }
    );

    // Listen for notification responses (when user taps notification)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        // Handle deep linking based on notification data
        console.log("Notification tapped:", data);
      }
    );

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  const requestPermissions = async (): Promise<boolean> => {
    if (!Device.isDevice) {
      console.warn("Push notifications only work on physical devices");
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    setPermissionStatus(finalStatus);

    if (finalStatus !== "granted") {
      return false;
    }

    // Get the push token
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    setExpoPushToken(tokenData.data);

    // Configure Android channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("alerts", {
        name: "Alerts",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF6B5B",
      });
    }

    return true;
  };

  const registerToken = async (userId: string): Promise<void> => {
    if (!expoPushToken) {
      console.warn("No push token available to register");
      return;
    }

    const platform = Platform.OS as "ios" | "android";

    // Upsert token - update if exists, insert if not
    const { error } = await supabase.from("push_tokens").upsert(
      {
        user_id: userId,
        token: expoPushToken,
        platform,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,token",
      }
    );

    if (error) {
      console.error("Failed to register push token:", error);
    }
  };

  return {
    expoPushToken,
    permissionStatus,
    notification,
    requestPermissions,
    registerToken,
  };
}
```

**Step 2: Commit**

```bash
git add hooks/useNotifications.ts
git commit -m "$(cat <<'EOF'
feat: add useNotifications hook for push notification handling
EOF
)"
```

---

## Task 3: Create push_tokens unique constraint migration

**Files:**
- Create: `docs/migrations/push_tokens_unique_constraint.sql`

**Step 1: Create migration file**

Create `docs/migrations/push_tokens_unique_constraint.sql`:

```sql
-- Add unique constraint for upsert to work correctly
-- This allows one token per user per device (identified by token string)

ALTER TABLE push_tokens
ADD CONSTRAINT push_tokens_user_token_unique UNIQUE (user_id, token);

-- Add index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
```

**Step 2: Apply migration to Supabase**

Run this SQL in Supabase Dashboard SQL Editor.

**Step 3: Commit**

```bash
git add docs/migrations/push_tokens_unique_constraint.sql
git commit -m "$(cat <<'EOF'
feat: add unique constraint for push_tokens upsert
EOF
)"
```

---

## Task 4: Initialize notifications in app layout

**Files:**
- Modify: `app/_layout.tsx`

**Step 1: Add notification initialization**

Edit `app/_layout.tsx` - add imports at top:

```typescript
import "../global.css";
import { useEffect, useRef } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingStore } from "@/stores/onboarding";
import { useNotifications } from "@/hooks/useNotifications";
```

**Step 2: Add notification setup in RootLayout**

Edit `app/_layout.tsx` - add notification setup after existing hooks in RootLayout:

```typescript
export default function RootLayout() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const {
    hasSeenOnboarding,
    isLoading: isOnboardingLoading,
    checkOnboardingStatus,
  } = useOnboardingStore();
  const { requestPermissions, registerToken, expoPushToken } = useNotifications();
  const hasRegisteredToken = useRef(false);

  // Check onboarding status on mount only
  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  // Request notification permissions when user is logged in
  useEffect(() => {
    if (user && !isAuthLoading) {
      requestPermissions();
    }
  }, [user, isAuthLoading]);

  // Register push token when available and user is logged in
  useEffect(() => {
    if (user && expoPushToken && !hasRegisteredToken.current) {
      hasRegisteredToken.current = true;
      registerToken(user.id);
    }
  }, [user, expoPushToken]);

  useProtectedRoute(user, isAuthLoading, hasSeenOnboarding, isOnboardingLoading);

  // ... rest of component unchanged
}
```

**Step 3: Commit**

```bash
git add app/_layout.tsx
git commit -m "$(cat <<'EOF'
feat: initialize notifications and register push token on app start
EOF
)"
```

---

## Task 5: Update Edge Function to send push notifications

**Files:**
- Modify: `supabase/functions/check-deadlines/index.ts`

**Step 1: Add push token interface and helper function**

Edit `supabase/functions/check-deadlines/index.ts` - add after existing interfaces (around line 22):

```typescript
interface PushToken {
  token: string;
  platform: string;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
}

async function sendPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<void> {
  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    title,
    body,
    data,
    sound: "default",
    channelId: "alerts",
  }));

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    console.log("Push notification result:", JSON.stringify(result));
  } catch (error) {
    console.error("Failed to send push notifications:", error);
  }
}
```

**Step 2: Replace TODO comment with notification sending logic**

Edit `supabase/functions/check-deadlines/index.ts` - replace lines 115-118 (the TODO section) with:

```typescript
      // Send push notifications to guardians
      if (guardianIds.length > 0) {
        // Get push tokens for all guardians
        const { data: pushTokens } = await supabase
          .from("push_tokens")
          .select("token")
          .in("user_id", guardianIds)
          .returns<PushToken[]>();

        if (pushTokens && pushTokens.length > 0) {
          const tokens = pushTokens.map((t) => t.token);
          const deadlineDate = new Date(profile.next_deadline);
          const now = new Date();
          const minutesOverdue = Math.round(
            (now.getTime() - deadlineDate.getTime()) / 60000
          );

          let overdueText = "";
          if (minutesOverdue < 60) {
            overdueText = `${minutesOverdue} min`;
          } else {
            const hours = Math.floor(minutesOverdue / 60);
            overdueText = `${hours} hod`;
          }

          await sendPushNotifications(
            tokens,
            `⚠️ ${profile.name} se neohlásil/a!`,
            `Měsíc po termínu: ${overdueText}`,
            {
              type: "alert",
              profileId: profile.id,
              ownerId: profile.owner_id,
              lat: profile.last_known_lat,
              lng: profile.last_known_lng,
            }
          );

          console.log(
            `Push notifications sent for profile ${profile.name} to ${tokens.length} devices`
          );
        }
      }
```

**Step 3: Commit**

```bash
git add supabase/functions/check-deadlines/index.ts
git commit -m "$(cat <<'EOF'
feat: send push notifications to guardians when alert is created
EOF
)"
```

---

## Task 6: Deploy updated Edge Function

**Files:**
- No file changes

**Step 1: Deploy the function**

Run:
```bash
npx supabase functions deploy check-deadlines --project-ref <your-project-ref>
```

Or deploy via Supabase Dashboard.

**Step 2: Verify deployment**

Check function logs in Supabase Dashboard → Edge Functions → check-deadlines → Logs

---

## Task 7: Add notification response handler with deep linking

**Files:**
- Modify: `hooks/useNotifications.ts`
- Modify: `app/_layout.tsx`

**Step 1: Update hook to expose navigation callback**

Edit `hooks/useNotifications.ts` - update the interface and hook:

```typescript
export interface UseNotificationsResult {
  expoPushToken: string | null;
  permissionStatus: Notifications.PermissionStatus | null;
  notification: Notifications.Notification | null;
  requestPermissions: () => Promise<boolean>;
  registerToken: (userId: string) => Promise<void>;
  setNotificationResponseHandler: (
    handler: (data: Record<string, unknown>) => void
  ) => void;
}

export function useNotifications(): UseNotificationsResult {
  // ... existing state ...
  const responseHandlerRef = useRef<((data: Record<string, unknown>) => void) | null>(
    null
  );

  useEffect(() => {
    // ... existing permission check ...

    // ... existing notificationListener ...

    // Listen for notification responses (when user taps notification)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        if (responseHandlerRef.current) {
          responseHandlerRef.current(data as Record<string, unknown>);
        }
      }
    );

    return () => {
      // ... existing cleanup ...
    };
  }, []);

  const setNotificationResponseHandler = (
    handler: (data: Record<string, unknown>) => void
  ) => {
    responseHandlerRef.current = handler;
  };

  return {
    expoPushToken,
    permissionStatus,
    notification,
    requestPermissions,
    registerToken,
    setNotificationResponseHandler,
  };
}
```

**Step 2: Add deep linking in layout**

Edit `app/_layout.tsx` - add navigation handler:

```typescript
export default function RootLayout() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const {
    hasSeenOnboarding,
    isLoading: isOnboardingLoading,
    checkOnboardingStatus,
  } = useOnboardingStore();
  const {
    requestPermissions,
    registerToken,
    expoPushToken,
    setNotificationResponseHandler,
  } = useNotifications();
  const hasRegisteredToken = useRef(false);

  // ... existing useEffects ...

  // Handle notification tap - navigate to guardians screen
  useEffect(() => {
    setNotificationResponseHandler((data) => {
      if (data.type === "alert") {
        // Navigate to guardians tab where watched profiles are shown
        router.push("/(tabs)/guardians");
      }
    });
  }, [router]);

  // ... rest unchanged ...
}
```

**Step 3: Commit**

```bash
git add hooks/useNotifications.ts app/_layout.tsx
git commit -m "$(cat <<'EOF'
feat: add deep linking from notification tap to guardians screen
EOF
)"
```

---

## Task 8: Add token cleanup on logout

**Files:**
- Modify: `hooks/useAuth.ts`

**Step 1: Read current useAuth implementation**

Read `hooks/useAuth.ts` to understand current structure.

**Step 2: Add token cleanup in signOut**

Edit `hooks/useAuth.ts` - update signOut function to remove push token:

```typescript
const signOut = async () => {
  try {
    // Get current user before signing out
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      // Remove all push tokens for this user
      await supabase
        .from("push_tokens")
        .delete()
        .eq("user_id", user.id);
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
};
```

**Step 3: Commit**

```bash
git add hooks/useAuth.ts
git commit -m "$(cat <<'EOF'
feat: remove push tokens on user logout
EOF
)"
```

---

## Task 9: Test notification flow manually

**Files:**
- No file changes

**Step 1: Build and run on physical device**

Run:
```bash
npx expo run:ios
# or
npx expo run:android
```

**Step 2: Test scenarios**

1. **Permission request:** App should ask for notification permission on first login
2. **Token registration:** Check `push_tokens` table in Supabase - should have entry for logged-in user
3. **Alert trigger:** Set a profile deadline to past, wait for cron to run (or invoke function manually)
4. **Notification received:** Guardian device should receive push notification
5. **Deep link:** Tapping notification should open app on guardians tab
6. **Logout cleanup:** After logout, `push_tokens` entry should be removed

**Step 3: Manual function invocation for testing**

```bash
curl -X POST 'https://<project-ref>.supabase.co/functions/v1/check-deadlines' \
  -H 'Authorization: Bearer <anon-key>' \
  -H 'Content-Type: application/json'
```

---

## Task 10: Add RLS policy for push_tokens table

**Files:**
- Create: `docs/migrations/push_tokens_rls.sql`

**Step 1: Create RLS migration**

Create `docs/migrations/push_tokens_rls.sql`:

```sql
-- Enable RLS on push_tokens
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own push tokens
CREATE POLICY "Users can insert own tokens"
ON push_tokens FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own tokens"
ON push_tokens FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own tokens"
ON push_tokens FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tokens"
ON push_tokens FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service role can read all tokens (for Edge Function)
-- Note: Service role bypasses RLS by default
```

**Step 2: Apply migration**

Run SQL in Supabase Dashboard SQL Editor.

**Step 3: Commit**

```bash
git add docs/migrations/push_tokens_rls.sql
git commit -m "$(cat <<'EOF'
feat: add RLS policies for push_tokens table
EOF
)"
```

---

## Summary

After completing all tasks:

- ✅ expo-notifications installed and configured
- ✅ Push token registration on app init
- ✅ Edge Function sends notifications to guardians
- ✅ Deep linking from notification to guardians screen
- ✅ Token cleanup on logout
- ✅ RLS policies for push_tokens table

**Total tasks:** 10
**Key integration point:** `supabase/functions/check-deadlines/index.ts` line 115
