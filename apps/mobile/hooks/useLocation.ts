// hooks/useLocation.ts
import { useState, useEffect, useCallback } from "react";
import * as Location from "expo-location";

export type PermissionStatus = "granted" | "denied" | "undetermined" | null;

interface LocationCoords {
  lat: number;
  lng: number;
}

interface UseLocationResult {
  permissionStatus: PermissionStatus;
  isLoading: boolean;
  requestPermission: () => Promise<boolean>;
  getCurrentPosition: (timeoutMs?: number) => Promise<LocationCoords | null>;
}

export function useLocation(): UseLocationResult {
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check permission on mount
  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      setPermissionStatus(status as PermissionStatus);
    } catch (error) {
      console.error("Error checking location permission:", error);
      setPermissionStatus("denied");
    } finally {
      setIsLoading(false);
    }
  };

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status as PermissionStatus);
      return status === "granted";
    } catch (error) {
      console.error("Error requesting location permission:", error);
      setPermissionStatus("denied");
      return false;
    }
  }, []);

  const getCurrentPosition = useCallback(
    async (timeoutMs: number = 5000): Promise<LocationCoords | null> => {
      // If permission not granted, try to request
      if (permissionStatus !== "granted") {
        const granted = await requestPermission();
        if (!granted) return null;
      }

      try {
        const location = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error("Location timeout")), timeoutMs)
          ),
        ]);

        if (location && "coords" in location) {
          return {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
          };
        }
        return null;
      } catch (error) {
        console.error("Error getting location:", error);
        return null;
      }
    },
    [permissionStatus, requestPermission]
  );

  return {
    permissionStatus,
    isLoading,
    requestPermission,
    getCurrentPosition,
  };
}
