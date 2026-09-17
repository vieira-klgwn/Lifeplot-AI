import { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, type ThemePreference } from '../../src/theme';
import { useAuth } from '../../src/state/auth';
import { useSchedule } from '../../src/state/schedule';
import { apiRequest } from '../../src/lib/api';
import { clearPushToken } from '../../src/lib/notifications';
import { Banner, Body, Button, Card, Heading, Segmented } from '../../src/components/ui';

const REMINDER_OPTIONS = ['5', '10', '30', '60'] as const;

function confirm(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function Settings() {
  const { colors, preference, setPreference } = useTheme();
  const { user, updateProfile, signOut } = useAuth();
  const { refresh } = useSchedule();
  const [status, setStatus] = useState<string | null>(null);

  if (!user) return null;

  const reminderValue = String(user.defaultReminderMinutes) as (typeof REMINDER_OPTIONS)[number];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.container}>
        <Heading>Settings</Heading>
        {status ? <Banner tone="info" message={status} /> : null}

        <Card>
          <Body>{user.name}</Body>
          <Text style={{ color: colors.textMuted }}>{user.email}</Text>
          <Text style={{ color: colors.textMuted }}>Timezone: {user.timezone}</Text>
        </Card>

        <Card>
          <Body>Appearance</Body>
          <Segmented
            value={preference}
            onChange={(value) => setPreference(value as ThemePreference)}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Card>

        <Card>
          <Body>Default reminder</Body>
          <Segmented
            value={REMINDER_OPTIONS.includes(reminderValue) ? reminderValue : '10'}
            onChange={(value) => void updateProfile({ defaultReminderMinutes: Number(value) })}
            options={REMINDER_OPTIONS.map((value) => ({
              value,
              label: value === '60' ? '1 hour' : `${value} min`,
            }))}
          />
        </Card>

        <Card>
          <View style={styles.switchRow}>
            <Body>Push notifications</Body>
            <Switch
              accessibilityLabel="Push notifications"
              value={user.notificationsEnabled}
              onValueChange={(value) => {
                void updateProfile({ notificationsEnabled: value });
                if (!value) void clearPushToken();
              }}
            />
          </View>
          <View style={styles.switchRow}>
            <Body>Anonymous usage analytics</Body>
            <Switch
              accessibilityLabel="Anonymous usage analytics"
              value={user.analyticsEnabled}
              onValueChange={(value) => void updateProfile({ analyticsEnabled: value })}
            />
          </View>
          <View style={styles.switchRow}>
            <Body>Week starts Monday</Body>
            <Switch
              accessibilityLabel="Week starts Monday"
              value={user.weekStartsOn === 1}
              onValueChange={(value) => void updateProfile({ weekStartsOn: value ? 1 : 0 })}
            />
          </View>
        </Card>

        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />

        <Button
          label="Erase my schedule data"
          variant="danger"
          onPress={() =>
            confirm('Erase schedule data', 'Events, tasks, reminders and chats will be deleted.', () => {
              void (async () => {
                await apiRequest('/users/me/schedule-data', { method: 'DELETE' });
                await refresh();
                setStatus('Your schedule data was erased.');
              })();
            })
          }
        />

        <Button
          label="Delete my account"
          variant="danger"
          onPress={() =>
            confirm('Delete account', 'This permanently removes your account and all data.', () => {
              void (async () => {
                await apiRequest('/auth/account', { method: 'DELETE' });
                await signOut();
              })();
            })
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
});
