import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';
import { useTheme } from '../../src/theme';
import { useSchedule } from '../../src/state/schedule';
import { apiRequest } from '../../src/lib/api';
import { Banner, Button, Card, EmptyState, Field, Heading, Segmented } from '../../src/components/ui';
import type { Goal, Task } from '../../src/types';

export default function Tasks() {
  const { colors } = useTheme();
  const { tasks, loading, refresh } = useSchedule();
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [duration, setDuration] = useState('60');
  const [priority, setPriority] = useState('2');
  const [goalId, setGoalId] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = tasks.filter((task) => task.status !== 'DONE' && task.status !== 'CANCELLED');
  const done = tasks.filter((task) => task.status === 'DONE');

  useEffect(() => {
    void apiRequest<{ goals: Goal[] }>('/goals')
      .then((response) => setGoals(response.goals.filter((goal) => goal.status === 'ACTIVE')))
      .catch(() => undefined);
  }, []);

  const edit = (task: Task) => {
    setEditing(task.id);
    setTitle(task.title);
    setDeadline(task.deadline?.slice(0, 10) ?? '');
    setDuration(String(task.estimatedMinutes ?? 60));
    setPriority(String(task.priority));
    setGoalId(task.goalId);
  };

  const reset = () => {
    setEditing(null); setTitle(''); setDeadline(''); setDuration('60'); setPriority('2'); setGoalId(null);
  };

  const add = async () => {
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
      setError('Estimated duration must be between 5 and 1440 minutes.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(editing ? `/tasks/${editing}` : '/tasks', {
        method: editing ? 'PATCH' : 'POST',
        body: {
          title: title.trim(),
          deadlineDate: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null,
          estimatedMinutes: minutes,
          priority: Number(priority),
          goalId,
        },
      });
      reset();
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
          <Field label="Estimated minutes" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
          <Text style={{ color: colors.text }}>Priority</Text>
          <Segmented value={priority} onChange={setPriority}
            options={[{ value: '1', label: 'Low' }, { value: '2', label: 'Medium' }, { value: '3', label: 'High' }]} />
          {goals.length ? (
            <View style={styles.list}>
              <Text style={{ color: colors.textMuted }}>Related goal</Text>
              {[{ id: null, title: 'No goal' }, ...goals].map((goal) => (
                <Pressable key={goal.id ?? 'none'} accessibilityRole="radio" accessibilityState={{ selected: goalId === goal.id }}
                  onPress={() => setGoalId(goal.id)}>
                  <Text style={{ color: goalId === goal.id ? colors.primary : colors.text }}>{goal.title}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Button label={editing ? 'Save task' : 'Add task'} onPress={add} loading={busy} disabled={!title.trim()} />
          {editing ? <Button label="Cancel editing" variant="secondary" onPress={reset} /> : null}
        </Card>

        {open.length === 0 ? (
          <EmptyState title="No open tasks" hint="Deadlines you mention in chat show up here too." />
        ) : (
          <View style={styles.list}>
            {open.map((task) => (
              <View key={task.id}>
              <Pressable
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
              <Pressable accessibilityRole="button" onPress={() => edit(task)}>
                <Text style={{ color: colors.primary }}>Edit</Text>
              </Pressable>
              </View>
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
