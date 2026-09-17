import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { addDays, format, isSameDay, parseISO } from 'date-fns';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/state/auth';
import { useSchedule } from '../../src/state/schedule';
import { Banner, Body, Button, EmptyState, Heading } from '../../src/components/ui';
import { EventCard } from '../../src/components/EventCard';
import { dayLabel } from '../../src/lib/dates';

export default function Today() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { eventsOn, tasks, loading, offline, refresh } = useSchedule();
  const router = useRouter();
  const [offset, setOffset] = useState(0);

  const date = useMemo(() => addDays(new Date(), offset), [offset]);
  const events = eventsOn(date);
  const dueToday = tasks.filter(
    (task) => task.deadline && task.status !== 'DONE' && isSameDay(parseISO(task.deadline), date),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Heading>{offset === 0 ? 'Today' : format(date, 'EEEE')}</Heading>
            <Text style={{ color: colors.textMuted }}>{dayLabel(date)}</Text>
          </View>
          <View style={styles.nav}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous day"
              onPress={() => setOffset((value) => value - 1)}
              style={[styles.navButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <Text style={{ color: colors.text, fontSize: 18 }}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next day"
              onPress={() => setOffset((value) => value + 1)}
              style={[styles.navButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <Text style={{ color: colors.text, fontSize: 18 }}>›</Text>
            </Pressable>
          </View>
        </View>

        {offline ? <Banner tone="warning" message="Offline — showing your saved schedule." /> : null}

        {events.length === 0 ? (
          <EmptyState
            title={offset === 0 ? 'Nothing scheduled today' : 'Nothing scheduled'}
            hint="Ask UniFlow to add something, or create an event yourself."
          />
        ) : (
          <View style={styles.list}>
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </View>
        )}

        {dueToday.length > 0 ? (
          <View style={styles.list}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Due</Text>
            {dueToday.map((task) => (
              <View
                key={task.id}
                style={[styles.task, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Body>{task.title}</Body>
                <Text style={{ color: colors.textMuted }}>
                  {task.deadline ? format(parseISO(task.deadline), 'HH:mm') : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button label="Ask UniFlow" onPress={() => router.push('/(tabs)/chat')} />
          <Button label="Add event" variant="secondary" onPress={() => router.push('/event/new')} />
        </View>

        {user?.timezone ? (
          <Text style={[styles.footer, { color: colors.textMuted }]}>Times shown in {user.timezone}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nav: { flexDirection: 'row', gap: 8 },
  navButton: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  list: { gap: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  task: { flexDirection: 'row', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, padding: 14 },
  actions: { gap: 10, marginTop: 8 },
  footer: { textAlign: 'center', fontSize: 12, marginTop: 8 },
});
