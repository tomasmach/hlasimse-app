import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/components/navigation/FloatingTabBar";
import { COLORS } from "@/constants/design";

export default function TabLayout() {
  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerStyle: {
          backgroundColor: COLORS.cream.default,
        },
        headerTintColor: COLORS.charcoal.default,
        headerTitleStyle: {
          fontWeight: "600",
        },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Hlásím se",
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="guardians"
        options={{
          title: "Strážci",
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Historie",
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Nastavení",
          headerShown: false,
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
      <Tabs.Screen
        name="edit-name"
        options={{
          title: "Upravit jméno",
          href: null,
        }}
      />
      <Tabs.Screen
        name="delete-account"
        options={{
          title: "Smazat účet",
          href: null,
        }}
      />
      <Tabs.Screen
        name="interval-picker"
        options={{
          title: "Nastavit interval",
          href: null,
        }}
      />
      <Tabs.Screen name="profile-detail" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="diagnostics" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="data-export" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="safety-info" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="incident/[id]" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
