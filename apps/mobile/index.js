const { LogBox } = require("react-native");

// React Navigation still imports React Native's deprecated SafeAreaView before
// the route tree mounts. Product screens use react-native-safe-area-context.
LogBox.ignoreLogs(["SafeAreaView has been deprecated"]);

require("expo-router/entry");
