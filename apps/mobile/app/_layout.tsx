import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../src/theme';
import { AuthProvider, useAuth } from '../src/state/auth';
import { ScheduleProvider, useSchedule } from '../src/state/schedule';
import { clearPushToken, registerForLocalNotifications } from '../src/lib/notifications';

function Gate() {
  const { user, loading } = useAuth();
  const { refresh } = useSchedule();
  const { colors, scheme } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const group = segments[0];
    if (!user) {
      if (group !== '(auth)') router.replace('/(auth)/sign-in');
      return;
    }
    if (!user.onboardedAt) {
      if (group !== 'onboarding') router.replace('/onboarding');
      return;
    }
    if (group === '(auth)' || group === 'onboarding' || group === undefined) {
      router.replace('/(tabs)');
    }
  }, [loading, router, segments, user]);

  useEffect(() => {
    if (user?.notificationsEnabled) {
      void registerForLocalNotifications()
        .then(async (granted) => {
          await clearPushToken();
          if (granted) await refresh();
        })
        .catch(() => undefined);
    }
  }, [user?.notificationsEnabled, user?.id, refresh]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Slot />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ScheduleProvider>
            <Gate />
          </ScheduleProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
