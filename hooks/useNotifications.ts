import { useState, useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import Constants from "expo-constants";

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
    handler: (data: Record<string, unknown>) => void
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
        if (responseHandlerRef.current) {
          responseHandlerRef.current(data as Record<string, unknown>);
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
    if (!projectId) {
      console.warn("Missing EAS projectId in app config");
      return false;
    }

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      if (!tokenData?.data) {
        console.warn("Failed to retrieve push token data");
        return false;
      }
      setExpoPushToken(tokenData.data);
    } catch (error) {
      console.error("Failed to get push token:", error);
      return false;
    }

    // Configure Android notification channels
    if (Platform.OS === "android") {
      const channels = [
        { id: "alerts", name: "Alerts" },
        { id: "reminders", name: "Připomínky" },
      ];
      for (const channel of channels) {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#FF6B5B",
        });
      }
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
