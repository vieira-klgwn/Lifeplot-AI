import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme';
import { rangeLabel } from '../lib/dates';
import { categoryColor } from './ui';
import type { ScheduleEvent } from '../types';

export function EventCard({ event }: { event: ScheduleEvent }) {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${rangeLabel(event.startTime, event.endTime)}`}
      onPress={() => router.push(`/event/${event.id}`)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.stripe, { backgroundColor: categoryColor(event.category) }]} />
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={{ color: colors.textMuted }}>
          {rangeLabel(event.startTime, event.endTime)}
          {event.location ? ` · ${event.location}` : ''}
        </Text>
      </View>
      {event.recurrenceRuleId ? (
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>repeats</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  stripe: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  content: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '700' },
});
