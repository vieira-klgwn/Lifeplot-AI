import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addMonths, format } from 'date-fns';
import { useTheme } from '../src/theme';
import { useAuth } from '../src/state/auth';
import { useSchedule } from '../src/state/schedule';
import { apiRequest } from '../src/lib/api';
import { Banner, Body, Button, Card, Field, Heading, Segmented } from '../src/components/ui';
import { DATE_FORMAT } from '../src/lib/dates';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0];

export default function Onboarding() {
  const { colors } = useTheme();
  const { user, updateProfile } = useAuth();
  const { refresh } = useSchedule();
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:30');
  const [days, setDays] = useState<number[]>([]);
  const [reminder, setReminder] = useState<'10' | '30' | '60'>('10');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleDay = (value: number) =>
    setDays((current) =>
      current.includes(value) ? current.filter((day) => day !== value) : [...current, value],
    );

  const addClass = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const today = new Date();
      await apiRequest('/events/recurring', {
        method: 'POST',
        body: {
          title: title.trim(),
          location: location.trim() || null,
          byWeekday: days,
          startTime,
          endTime,
          startDate: format(today, DATE_FORMAT),
          endDate: format(addMonths(today, 4), DATE_FORMAT),
          category: 'CLASS',
          reminderMinutes: Number(reminder),
        },
      });
      setStatus(`${title.trim()} added to your week.`);
      setTitle('');
      setLocation('');
      setDays([]);
      await refresh();
    } catch {
      setStatus('Could not add that class. Check the times and try again.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await updateProfile({ defaultReminderMinutes: Number(reminder), onboarded: true });
    await refresh();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Heading>Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</Heading>
        <Body muted>
          Add your recurring classes once. Everything else you can just say to LifePilot in chat.
        </Body>

        {status ? <Banner tone="info" message={status} /> : null}

        <Card>
          <Field label="Class name" value={title} onChangeText={setTitle} placeholder="Linear Algebra" />
          <Field label="Room (optional)" value={location} onChangeText={setLocation} placeholder="Silver 401" />
          <View style={styles.times}>
            <View style={{ flex: 1 }}>
              <Field label="Starts" value={startTime} onChangeText={setStartTime} placeholder="09:00" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Ends" value={endTime} onChangeText={setEndTime} placeholder="10:30" />
            </View>
          </View>

          <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Repeats on</Text>
          <View style={styles.days}>
            {WEEKDAYS.map((label, index) => {
              const value = WEEKDAY_VALUES[index]!;
              const active = days.includes(value);
              return (
                <Text
                  key={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => toggleDay(value)}
                  style={[
                    styles.day,
                    {
                      backgroundColor: active ? colors.primary : colors.surfaceAlt,
                      color: active ? colors.primaryText : colors.textMuted,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  {label}
                </Text>
              );
            })}
          </View>

          <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Remind me before</Text>
          <Segmented
            value={reminder}
            onChange={setReminder}
            options={[
              { value: '10', label: '10 min' },
              { value: '30', label: '30 min' },
              { value: '60', label: '1 hour' },
            ]}
          />

          <Button
            label="Add class"
            onPress={addClass}
            loading={busy}
            disabled={!title.trim() || days.length === 0}
          />
        </Card>

        <Button label="Continue to my schedule" variant="secondary" onPress={finish} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  times: { flexDirection: 'row', gap: 12 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  day: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontWeight: '600',
    overflow: 'hidden',
  },
});
