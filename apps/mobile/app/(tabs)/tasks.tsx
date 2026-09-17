import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';
import { useTheme } from '../../src/theme';
import { useSchedule } from '../../src/state/schedule';
import { apiRequest } from '../../src/lib/api';
import { Banner, Button, Card, EmptyState, Field, Heading } from '../../src/components/ui';

export default function Tasks() {
  const { colors } = useTheme();
  const { tasks, loading, refresh } = useSchedule();
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = tasks.filter((task) => task.status !== 'DONE' && task.status !== 'CANCELLED');
  const done = tasks.filter((task) => task.status === 'DONE');

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/tasks', {
        method: 'POST',
        body: {
          title: title.trim(),
          deadlineDate: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null,
        },
      });
      setTitle('');
      setDeadline('');
      await refresh();
    } catch {
      setError('Could not save that task.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string, status: string) => {
    await apiRequest(`/tasks/${id}`, {
      method: 'PATCH',
      body: { status: status === 'DONE' ? 'PENDING' : 'DONE' },
    }).catch(() => undefined);
    await refresh();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        <Heading>Tasks &amp; deadlines</Heading>
        {error ? <Banner tone="danger" message={error} /> : null}

        <Card>
          <Field label="Task" value={title} onChangeText={setTitle} placeholder="Finish problem set 3" />
          <Field
            label="Deadline (YYYY-MM-DD, optional)"
            value={deadline}
            onChangeText={setDeadline}
            placeholder="2026-09-24"
            autoCapitalize="none"
          />
          <Button label="Add task" onPress={add} loading={busy} disabled={!title.trim()} />
        </Card>

        {open.length === 0 ? (
          <EmptyState title="No open tasks" hint="Deadlines you mention in chat show up here too." />
        ) : (
          <View style={styles.list}>
            {open.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: false }}
                accessibilityLabel={task.title}
                onPress={() => void toggle(task.id, task.status)}
                style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={[styles.box, { borderColor: colors.border }]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{task.title}</Text>
                  {task.deadline ? (
                    <Text style={{ color: colors.textMuted }}>
                      Due {format(parseISO(task.deadline), 'EEE d MMM HH:mm')}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {done.length > 0 ? (
          <View style={styles.list}>
            <Text style={{ color: colors.textMuted, fontWeight: '700', marginTop: 10 }}>Completed</Text>
            {done.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: true }}
                accessibilityLabel={task.title}
                onPress={() => void toggle(task.id, task.status)}
                style={[styles.row, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
              >
                <View style={[styles.box, { borderColor: colors.success, backgroundColor: colors.success }]} />
                <Text style={{ color: colors.textMuted, textDecorationLine: 'line-through', flex: 1 }}>
                  {task.title}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 },
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2 },
});
