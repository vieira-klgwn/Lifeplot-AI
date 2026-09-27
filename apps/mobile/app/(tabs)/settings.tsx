import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, type ThemePreference } from '../../src/theme';
import { useAuth } from '../../src/state/auth';
import { useSchedule } from '../../src/state/schedule';
import { apiRequest } from '../../src/lib/api';
import { clearPushToken, reconcileLocalReminders } from '../../src/lib/notifications';
import { Banner, Body, Button, Card, Field, Heading, Segmented } from '../../src/components/ui';

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
  const [wakeTime, setWakeTime] = useState(user?.wakeTime ?? '07:00');
  const [bedTime, setBedTime] = useState(user?.bedTime ?? '23:00');
  const [workStartTime, setWorkStartTime] = useState(user?.workStartTime ?? '09:00');
  const [workEndTime, setWorkEndTime] = useState(user?.workEndTime ?? '19:00');
  const [protectEvenings, setProtectEvenings] = useState(user?.protectEvenings ?? false);
  const [apiKey, setApiKey] = useState('');
  const [aiStatus, setAiStatus] = useState('Checking AI connection…');
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    void apiRequest<{ provider: string; personalKeyConfigured: boolean }>('/ai/provider')
      .then((response) => setAiStatus(response.personalKeyConfigured
        ? 'OpenAI key saved on the server' : response.provider === 'local' ? 'Mock mode' : 'OpenAI (server key)'))
      .catch(() => setAiStatus('AI status unavailable offline'));
  }, []);

  const testAI = async () => {
    setAiBusy(true);
    try {
      const response = await apiRequest<{ connected: boolean; message?: string }>('/ai/provider/test', {
        method: 'POST', body: apiKey ? { apiKey } : {},
      });
      setAiStatus(response.connected ? 'OpenAI connection successful' : response.message ?? 'Mock mode');
    } catch {
      setAiStatus('Connection failed. Check your key and network.');
    } finally {
      setAiBusy(false);
    }
  };

  const saveAI = async () => {
    setAiBusy(true);
    try {
      await apiRequest('/ai/provider', { method: 'PUT', body: { apiKey } });
      setApiKey('');
      setAiStatus('OpenAI key saved on the server');
    } catch {
      setAiStatus('Could not save your key. Check the key and try again.');
    } finally {
      setAiBusy(false);
    }
  };

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
          <Body>AI connection</Body>
          <Text style={{ color: colors.textMuted }}>{aiStatus}</Text>
          <Field label="Your OpenAI API key" value={apiKey} onChangeText={setApiKey}
            secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <Button label="Test connection" onPress={() => void testAI()} loading={aiBusy} />
          <Button label="Save key" onPress={() => void saveAI()} disabled={!apiKey.trim()} loading={aiBusy} />
          <Button label="Remove personal key" variant="secondary" onPress={() => {
            void apiRequest('/ai/provider', { method: 'DELETE' })
              .then(() => setAiStatus('Mock mode'))
              .catch(() => setAiStatus('Could not remove key.'));
          }} />
          <Body muted>The key is encrypted on the API server and never returned to the app. Mock mode uses rule-based replies.</Body>
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
          <Body>Plan around your life</Body>
          <View style={styles.switchRow}>
            <Body>Protect evenings after work</Body>
            <Switch accessibilityLabel="Protect evenings" value={protectEvenings} onValueChange={setProtectEvenings} />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}><Field label="Wake (HH:mm)" value={wakeTime} onChangeText={setWakeTime} /></View>
            <View style={{ flex: 1 }}><Field label="Bedtime (HH:mm)" value={bedTime} onChangeText={setBedTime} /></View>
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}><Field label="Work starts" value={workStartTime} onChangeText={setWorkStartTime} /></View>
            <View style={{ flex: 1 }}><Field label="Work ends" value={workEndTime} onChangeText={setWorkEndTime} /></View>
          </View>
          <Button label="Save planning preferences" onPress={() => {
            void updateProfile({ wakeTime, bedTime, workStartTime, workEndTime, protectEvenings })
              .then(() => setStatus('Planning preferences saved.'))
              .catch(() => setStatus('Check the times: work must fit between waking and bedtime.'));
          }} />
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
                if (!value) {
                  void clearPushToken();
                  void reconcileLocalReminders([], [], [], false, user.id);
                }
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
