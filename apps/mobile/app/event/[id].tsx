import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { useTheme } from '../../src/theme';
import { useSchedule } from '../../src/state/schedule';
import { apiRequest } from '../../src/lib/api';
import { Banner, Button, Card, Field, Heading } from '../../src/components/ui';
import { minutesBetween } from '../../src/lib/dates';
import type { ScheduleEvent } from '../../src/types';

interface Draft {
  title: string;
  date: string;
  startTime: string;
  duration: string;
  location: string;
}

function draftFrom(event: ScheduleEvent | null): Draft {
  if (!event) return { title: '', date: '', startTime: '', duration: '', location: '' };
  return {
    title: event.title,
    date: format(parseISO(event.startTime), 'yyyy-MM-dd'),
    startTime: format(parseISO(event.startTime), 'HH:mm'),
    duration: String(minutesBetween(event.startTime, event.endTime)),
    location: event.location ?? '',
  };
}

export default function EventDetail() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { events, refresh } = useSchedule();

  const [fetched, setFetched] = useState<ScheduleEvent | null>(null);
  const event = useMemo(
    () => events.find((candidate) => candidate.id === id) ?? fetched,
    [events, fetched, id],
  );

  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);

  const draft: Draft = { ...draftFrom(event), ...edits };
  const patch = (key: keyof Draft) => (value: string) =>
    setEdits((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (event || !id || removed) return;
    apiRequest<{ event: ScheduleEvent }>(`/events/${id}`)
      .then((payload) => setFetched(payload.event))
      .catch(() => setError('That event is no longer available.'));
  }, [event, id, removed]);

  const save = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/events/${id}`, {
        method: 'PATCH',
        body: {
          title: draft.title.trim(),
          location: draft.location.trim() || null,
          date: draft.date,
          startTime: draft.startTime,
          durationMinutes: Number(draft.duration),
        },
      });
      await refresh();
      router.back();
    } catch {
      setError('Could not save. Check the date (YYYY-MM-DD) and time (HH:mm).');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (scope: 'this' | 'all') => {
    if (!id) return;
    setBusy(true);
    try {
      await apiRequest(`/events/${id}`, { method: 'DELETE', query: { scope } });
      setRemoved(true);
      await refresh();
      router.back();
    } catch {
      setError('Could not delete that event.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: 'Event' }} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Heading>Edit event</Heading>
        {error ? <Banner tone="danger" message={error} /> : null}

        <Card>
          <Field label="Title" value={draft.title} onChangeText={patch('title')} />
          <Field
            label="Date"
            value={draft.date}
            onChangeText={patch('date')}
            placeholder="2026-09-20"
            autoCapitalize="none"
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Start" value={draft.startTime} onChangeText={patch('startTime')} placeholder="14:00" />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Minutes"
                value={draft.duration}
                onChangeText={patch('duration')}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <Field label="Location" value={draft.location} onChangeText={patch('location')} placeholder="Bobst 5" />
          <Button label="Save changes" onPress={save} loading={busy} disabled={!draft.title.trim()} />
        </Card>

        {event?.recurrenceRuleId ? (
          <Text style={{ color: colors.textMuted }}>This event repeats weekly.</Text>
        ) : null}

        <Button label="Delete this event" variant="danger" onPress={() => void remove('this')} />
        {event?.recurrenceRuleId ? (
          <Button label="Delete the whole series" variant="danger" onPress={() => void remove('all')} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 },
  row: { flexDirection: 'row', gap: 12 },
});
