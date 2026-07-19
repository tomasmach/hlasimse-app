import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const CHUNK_SIZE = 2000;
const CHUNK_PREFIX = "__chunk_";
const COUNT_SUFFIX = "__count";

async function removeChunks(key: string) {
  const countStr = await SecureStore.getItemAsync(key + COUNT_SUFFIX);
  if (countStr) {
    const count = parseInt(countStr, 10);
    for (let i = 0; i < count; i++) {
      try {
        await SecureStore.deleteItemAsync(`${key}${CHUNK_PREFIX}${i}`);
      } catch (error) {
        console.warn(`Failed to delete chunk ${i} for key ${key}:`, error);
      }
    }
    try {
      await SecureStore.deleteItemAsync(key + COUNT_SUFFIX);
    } catch (error) {
      console.warn(`Failed to delete count suffix for key ${key}:`, error);
    }
  }
}

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    const countStr = await SecureStore.getItemAsync(key + COUNT_SUFFIX);
    if (countStr) {
      const count = parseInt(countStr, 10);
      let value = "";
      for (let i = 0; i < count; i++) {
        const chunk = await SecureStore.getItemAsync(
          `${key}${CHUNK_PREFIX}${i}`
        );
        if (chunk) value += chunk;
      }
      return value || null;
    }
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string) => {
    await removeChunks(key);
    await SecureStore.deleteItemAsync(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${key}${CHUNK_PREFIX}${i}`, chunks[i]);
    }
    await SecureStore.setItemAsync(key + COUNT_SUFFIX, String(chunks.length));
  },
  removeItem: async (key: string) => {
    await removeChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
