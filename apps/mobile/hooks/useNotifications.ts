import { useState, useEffect, useRef, useCallback } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
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
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const responseHandlerRef = useRef<((data: Record<string, unknown>) => void) | null>(null);
  const responseDispatcherRef = useRef<ReturnType<typeof createResponseOnceDispatcher> | null>(null);

  const loadExpoPushToken = useCallback(async (): Promise<boolean> => {
    if (!Device.isDevice) return false;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn("Missing EAS projectId in app config");
      return false;
    }
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      if (!tokenData?.data) return false;
      setExpoPushToken(tokenData.data);
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
      return true;
    } catch (error) {
      console.error("Failed to get push token:", error);
      return false;
    }
  }, []);

  useEffect(() => {
    // Check current permission status on mount
    Notifications.getPermissionsAsync().then(({ status }) => {
      setPermissionStatus(status);
      // Refresh an existing registration without showing an OS prompt.
      if (status === "granted") void loadExpoPushToken();
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
    if (!expoPushToken) {
      console.warn("No push token available to register");
      return;
    }

    try {
      await registerPushDevice(expoPushToken);
    } catch (error) {
      console.error("Failed to register push token:", error);
    }
  }, [expoPushToken]);

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
    requestPermissions,
    registerToken,
    setNotificationResponseHandler,
  };
}
