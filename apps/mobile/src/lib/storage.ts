import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Tokens live in the device keychain/keystore. SecureStore has no web
 * implementation, so the web preview falls back to AsyncStorage.
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
    return SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
    return SecureStore.deleteItemAsync(key);
  },
};

/** Last-known schedule data so the app still opens without a network. */
export const cache = {
  async read<T>(key: string): Promise<T | null> {
    const raw = await AsyncStorage.getItem(`lifepilot.cache.${key}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async write(key: string, value: unknown): Promise<void> {
    await AsyncStorage.setItem(`lifepilot.cache.${key}`, JSON.stringify(value));
  },
  async clear(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((key) => key.startsWith('lifepilot.cache.')));
  },
};
