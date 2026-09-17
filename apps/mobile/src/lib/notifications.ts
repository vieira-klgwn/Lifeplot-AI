import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { apiRequest } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Reminders are delivered by the backend worker through Expo Push so they still
 * arrive when the app is closed; the device only has to hand over its token.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Schedule reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F7DF3',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;

  const token = await Notifications.getExpoPushTokenAsync();
  await apiRequest('/users/me/push-token', { method: 'PUT', body: { pushToken: token.data } });
  return token.data;
}

export async function clearPushToken(): Promise<void> {
  await apiRequest('/users/me/push-token', { method: 'PUT', body: { pushToken: null } }).catch(
    () => undefined,
  );
}
