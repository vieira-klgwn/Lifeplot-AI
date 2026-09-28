import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { useTheme } from '../../src/theme';
import { useSchedule } from '../../src/state/schedule';
import { apiRequest } from '../../src/lib/api';
import { Banner, Button, Card, Field, Heading, Segmented } from '../../src/components/ui';
import type { EventCategory } from '../../src/types';

const CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: 'CLASS', label: 'Class' },
  { value: 'STUDY', label: 'Study' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'PERSONAL', label: 'Personal' },
];

export default function NewEvent() {
  const { colors } = useTheme();
  const router = useRouter();
  const { refresh } = useSchedule();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('18:00');
  const [duration, setDuration] = useState('60');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<EventCategory>('STUDY');
  const [reminder, setReminder] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/events', {
        method: 'POST',
        body: {
          title: title.trim(),
          date,
          startTime,
          durationMinutes: Number(duration),
          location: location.trim() || null,
          category,
          reminderMinutes: Number(reminder),
        },
      });
      await refresh();
      router.back();
    } catch {
      setError('Could not create that event. Check the date and time format.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: 'New event' }} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Heading>New event</Heading>
        {error ? <Banner tone="danger" message={error} /> : null}

        <Card>
          <Field label="Title" value={title} onChangeText={setTitle} placeholder="Study group" />
          <Field label="Date" value={date} onChangeText={setDate} autoCapitalize="none" />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Start" value={startTime} onChangeText={setStartTime} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Minutes" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
            </View>
          </View>
          <Field label="Location" value={location} onChangeText={setLocation} placeholder="Library" />
          <Segmented value={category} onChange={setCategory} options={CATEGORIES} />
          <Segmented
            value={reminder}
            onChange={setReminder}
            options={[
              { value: '0', label: 'None' },
              { value: '10', label: '10 min' },
              { value: '30', label: '30 min' },
            ]}
          />
          <Button label="Create event" onPress={create} loading={busy} disabled={!title.trim()} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 },
  row: { flexDirection: 'row', gap: 12 },
});
