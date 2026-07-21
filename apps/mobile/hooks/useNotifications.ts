import { useState, useEffect, useRef, useCallback } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import { registerPushDevice } from "@/lib/pushDevices";
import { createResponseOnceDispatcher } from "@/lib/notificationRouting";

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface UseNotificationsResult {
  expoPushToken: string | null;
  permissionStatus: Notifications.PermissionStatus | null;
  notification: Notifications.Notification | null;
  tokenStatus: "unavailable" | "loading" | "ready" | "error";
  registrationStatus: "idle" | "registering" | "ready" | "error";
  requestPermissions: () => Promise<boolean>;
  registerToken: (userId: string) => Promise<void>;
  setNotificationResponseHandler: (
    handler: ((data: Record<string, unknown>) => void) | null
  ) => void;
}

export function useNotifications(): UseNotificationsResult {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] =
    useState<Notifications.PermissionStatus | null>(null);
  const [notification, setNotification] =
    useState<Notifications.Notification | null>(null);
  const [tokenStatus, setTokenStatus] = useState<"unavailable" | "loading" | "ready" | "error">("unavailable");
  const [registrationStatus, setRegistrationStatus] = useState<"idle" | "registering" | "ready" | "error">("idle");
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const responseHandlerRef = useRef<((data: Record<string, unknown>) => void) | null>(null);
  const responseDispatcherRef = useRef<ReturnType<typeof createResponseOnceDispatcher> | null>(null);

  const loadExpoPushToken = useCallback(async (): Promise<string | null> => {
    if (!Device.isDevice) {
      setTokenStatus("unavailable");
      return null;
    }
    setTokenStatus("loading");
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      setTokenStatus("error");
      throw new Error("Build nemá nakonfigurovaný projekt pro push upozornění.");
    }
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      if (!tokenData?.data) throw new Error("Expo push token tohoto zařízení není dostupný.");
      setExpoPushToken(tokenData.data);
      setTokenStatus("ready");
      if (Platform.OS === "android") {
        for (const channel of [{ id: "alerts", name: "Incidenty" }, { id: "reminders", name: "Připomínky" }]) {
          await Notifications.setNotificationChannelAsync(channel.id, {
            name: channel.name,
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#FF6B5B",
          });
        }
      }
      return tokenData.data;
    } catch (error) {
      setTokenStatus("error");
      console.error("Failed to get push token:", error);
      throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;
    let tokenRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let tokenRetryAttempt = 0;

    const refreshPermissionAndToken = async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (!active) return;
      setPermissionStatus(status);
      if (status !== "granted") {
        setExpoPushToken(null);
        setTokenStatus("unavailable");
        return;
      }
      try {
        await loadExpoPushToken();
        tokenRetryAttempt = 0;
      } catch {
        if (!active) return;
        const baseDelay = Math.min(30_000, 1_000 * (2 ** Math.min(tokenRetryAttempt, 5)));
        tokenRetryAttempt += 1;
        const delay = Math.round(baseDelay * (0.75 + Math.random() * 0.5));
        tokenRetryTimer = setTimeout(() => {
          if (active && AppState.currentState === "active") void refreshPermissionAndToken();
        }, delay);
      }
    };

    void refreshPermissionAndToken();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        tokenRetryAttempt = 0;
        if (tokenRetryTimer) clearTimeout(tokenRetryTimer);
        void refreshPermissionAndToken();
      }
    });
    const pushTokenSubscription = Notifications.addPushTokenListener(() => {
      if (active) void refreshPermissionAndToken();
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
        if (responseDispatcherRef.current?.(response as Parameters<ReturnType<typeof createResponseOnceDispatcher>>[0])) {
          void Notifications.clearLastNotificationResponseAsync();
        }
      }
    );

    return () => {
      active = false;
      if (tokenRetryTimer) clearTimeout(tokenRetryTimer);
      appStateSubscription.remove();
      pushTokenSubscription.remove();
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [loadExpoPushToken]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
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

    if (!(await loadExpoPushToken())) return false;

    return true;
  }, [loadExpoPushToken]);

  const registerToken = useCallback(async (_userId: string): Promise<void> => {
    setRegistrationStatus("registering");
    try {
      const token = expoPushToken || await loadExpoPushToken();
      if (!token) throw new Error("Push token tohoto zařízení není dostupný.");
      await registerPushDevice(token);
      setRegistrationStatus("ready");
    } catch (error) {
      setRegistrationStatus("error");
      throw error;
    }
  }, [expoPushToken, loadExpoPushToken]);

  const setNotificationResponseHandler = useCallback((
    handler: ((data: Record<string, unknown>) => void) | null
  ) => {
    responseHandlerRef.current = handler;
    if (!handler) {
      responseDispatcherRef.current = null;
      return;
    }
    responseDispatcherRef.current = createResponseOnceDispatcher(handler);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && responseDispatcherRef.current?.(response as Parameters<ReturnType<typeof createResponseOnceDispatcher>>[0])) {
        void Notifications.clearLastNotificationResponseAsync();
      }
    });
  }, []);

  return {
    expoPushToken,
    permissionStatus,
    notification,
    tokenStatus,
    registrationStatus,
    requestPermissions,
    registerToken,
    setNotificationResponseHandler,
  };
}
