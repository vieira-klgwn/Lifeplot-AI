import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addMonths, addWeeks, format, isSameDay, isSameMonth } from 'date-fns';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/state/auth';
import { useSchedule } from '../../src/state/schedule';
import { EmptyState, Heading, Segmented } from '../../src/components/ui';
import { EventCard } from '../../src/components/EventCard';
import { dayLabel, monthGrid, weekDays } from '../../src/lib/dates';

type Mode = 'week' | 'month';

export default function Calendar() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { eventsOn, loading, refresh } = useSchedule();
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(new Date());
  const [selected, setSelected] = useState(new Date());

  const weekStartsOn = user?.weekStartsOn === 0 ? 0 : 1;
  const days = useMemo(
    () => (mode === 'week' ? weekDays(anchor, weekStartsOn) : monthGrid(anchor, weekStartsOn)),
    [anchor, mode, weekStartsOn],
  );
  const selectedEvents = eventsOn(selected);

  const shift = (direction: -1 | 1) =>
    setAnchor((current) => (mode === 'week' ? addWeeks(current, direction) : addMonths(current, direction)));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <Heading>{format(anchor, mode === 'week' ? "'Week of' d MMM" : 'MMMM yyyy')}</Heading>

        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
        />

        <View style={styles.navRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous"
            onPress={() => shift(-1)}
            style={[styles.navButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Text style={{ color: colors.text }}>‹ Back</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Today"
            onPress={() => {
              setAnchor(new Date());
              setSelected(new Date());
            }}
            style={[styles.navButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Text style={{ color: colors.text }}>Today</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next"
            onPress={() => shift(1)}
            style={[styles.navButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Text style={{ color: colors.text }}>Next ›</Text>
          </Pressable>
        </View>

        <View style={styles.grid}>
          {days.map((day) => {
            const dayEvents = eventsOn(day);
            const active = isSameDay(day, selected);
            const dim = mode === 'month' && !isSameMonth(day, anchor);
            return (
              <Pressable
                key={day.toISOString()}
                accessibilityRole="button"
                accessibilityLabel={`${dayLabel(day)}, ${dayEvents.length} events`}
                accessibilityState={{ selected: active }}
                onPress={() => setSelected(day)}
                style={[
                  styles.cell,
                  mode === 'week' ? styles.weekCell : styles.monthCell,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: colors.border,
                    opacity: dim ? 0.45 : 1,
                  },
                ]}
              >
                <Text style={{ color: active ? colors.primaryText : colors.textMuted, fontSize: 11 }}>
                  {format(day, 'EEE')}
                </Text>
                <Text style={{ color: active ? colors.primaryText : colors.text, fontWeight: '700' }}>
                  {format(day, 'd')}
                </Text>
                <View style={styles.dots}>
                  {dayEvents.slice(0, 3).map((event) => (
                    <View
                      key={event.id}
                      style={[
                        styles.dot,
                        { backgroundColor: active ? colors.primaryText : colors.primary },
                      ]}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.selectedLabel, { color: colors.text }]}>{dayLabel(selected)}</Text>
        {selectedEvents.length === 0 ? (
          <EmptyState title="Free day" hint="Nothing scheduled — a good slot for deep work." />
        ) : (
          <View style={styles.list}>
            {selectedEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 },
  navRow: { flexDirection: 'row', gap: 8 },
  navButton: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: { borderRadius: 12, borderWidth: 1, alignItems: 'center', paddingVertical: 10, gap: 2 },
  weekCell: { width: '13.2%', minWidth: 42 },
  monthCell: { width: '13.2%', minWidth: 42 },
  dots: { flexDirection: 'row', gap: 2, height: 6 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  selectedLabel: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  list: { gap: 10 },
});
