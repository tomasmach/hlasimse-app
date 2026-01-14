import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#FF6B5B",
        tabBarInactiveTintColor: "#8B7F7A",
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: "#F5E6DC",
        },
        headerStyle: {
          backgroundColor: "#FFF8F5",
        },
        headerTintColor: "#2D2926",
        headerTitleStyle: {
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Hlásím se",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="hand-left" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="guardians"
        options={{
          title: "Strážci",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Nastavení",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile-setup"
        options={{
          title: "Nastavení profilu",
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}
