import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/state/auth';
import { apiRequest } from '../../src/lib/api';
import { cache } from '../../src/lib/storage';
import { Banner, Body, Button, Card, EmptyState, Field, Heading, Segmented } from '../../src/components/ui';
import type { Goal } from '../../src/types';

export default function Goals() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState('');
  const [weeklyHours, setWeeklyHours] = useState('2');
  const [editing, setEditing] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('PERSONAL');
  const [priority, setPriority] = useState('2');
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await apiRequest<{ goals: Goal[] }>('/goals');
      setGoals(result.goals);
      if (user) await cache.write(`${user.id}.goals`, result.goals);
    } catch {
      const saved = user ? await cache.read<Goal[]>(`${user.id}.goals`) : null;
      if (saved) setGoals(saved);
      setError('Offline — showing your saved goals.');
    }
  }, [user]);

  useEffect(() => { void Promise.resolve().then(() => refresh()); }, [refresh]);

  const reset = () => {
    setEditing(null); setTitle(''); setDescription(''); setWeeklyHours('2');
    setCategory('PERSONAL'); setPriority('2'); setTargetDate(''); setNotes(''); setProgress('0');
  };

  const save = async () => {
    const hours = Number(weeklyHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 168 ||
      !Number.isInteger(Number(progress)) || Number(progress) < 0 || Number(progress) > 100 ||
      Boolean(targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate))) {
      setError('Check weekly hours, progress (0–100), and target date (YYYY-MM-DD).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(editing ? `/goals/${editing}` : '/goals', {
        method: editing ? 'PATCH' : 'POST',
        body: {
          title: title.trim(), description: description.trim() || null, category: category.trim(),
          priority: Number(priority), targetDate: targetDate || null,
          weeklyMinutes: Math.round(hours * 60), notes: notes.trim() || null,
          progress: Number(progress),
        },
      });
      reset();
      await refresh();
    } catch {
      setError('Could not save your goal. Try again when connected.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (goal: Goal) => {
    setEditing(goal.id); setTitle(goal.title); setDescription(goal.description ?? '');
    setCategory(goal.category); setPriority(String(goal.priority));
    setTargetDate(goal.targetDate?.slice(0, 10) ?? '');
    setWeeklyHours(String(goal.weeklyMinutes / 60));
    setNotes(goal.notes ?? ''); setProgress(String(goal.progress));
  };

  const remove = (goal: Goal) => {
    const perform = () => void apiRequest(`/goals/${goal.id}`, { method: 'DELETE' })
      .then(() => refresh()).catch(() => setError('Could not delete your goal.'));
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`Delete ${goal.title}?`)) perform();
    } else {
      Alert.alert('Delete goal?', goal.title, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: perform },
      ]);
    }
  };

  const update = async (goal: Goal, patch: Partial<Goal>) => {
    try {
      await apiRequest(`/goals/${goal.id}`, { method: 'PATCH', body: patch });
      setError(null);
      await refresh();
    } catch {
      setError('Could not update your goal.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Heading>Goals</Heading>
        <Body muted>Make room for what matters, one week at a time.</Body>
        {error ? <Banner tone="warning" message={error} /> : null}
        <Card>
          <Field label="What are you working toward?" value={title} onChangeText={setTitle} placeholder="Build my startup" />
          <Field label="Description" value={description} onChangeText={setDescription} multiline />
          <Field label="Category" value={category} onChangeText={setCategory} />
          <Body>Priority</Body>
          <Segmented value={priority} onChange={setPriority}
            options={[{ value: '1', label: 'Low' }, { value: '2', label: 'Medium' }, { value: '3', label: 'High' }]} />
          <Field label="Target date (YYYY-MM-DD, optional)" value={targetDate} onChangeText={setTargetDate} />
          <Field label="Hours each week" value={weeklyHours} onChangeText={setWeeklyHours} keyboardType="decimal-pad" />
          <Field label="Progress (0–100)" value={progress} onChangeText={setProgress} keyboardType="number-pad" />
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
          <Button label={editing ? 'Save changes' : 'Add goal'} onPress={() => void save()} loading={busy} disabled={!title.trim()} />
          {editing ? <Button label="Cancel editing" variant="secondary" onPress={reset} /> : null}
        </Card>
        {goals.length === 0 ? <EmptyState title="Your next chapter starts here" hint="Add a goal to keep it in view." /> : null}
        {goals.map((goal) => (
          <Card key={goal.id}>
            <View style={styles.row}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 17, flex: 1 }}>{goal.title}</Text>
              <Text style={{ color: colors.textMuted }}>{goal.progress}%</Text>
            </View>
            <Body muted>{goal.weeklyMinutes / 60} hours per week · {goal.status.toLowerCase()}</Body>
            {goal.description ? <Body muted>{goal.description}</Body> : null}
            {goal.targetDate ? <Body muted>Target: {goal.targetDate.slice(0, 10)}</Body> : null}
            <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
              <View style={[styles.progress, { backgroundColor: colors.primary, width: `${goal.progress}%` }]} />
            </View>
            <View style={styles.row}>
              {goal.status !== 'COMPLETED' ? (
                <Pressable accessibilityRole="button" onPress={() => void update(goal, { status: goal.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}>
                  <Text style={{ color: colors.primary }}>{goal.status === 'ACTIVE' ? 'Pause' : 'Resume'}</Text>
                </Pressable>
              ) : null}
              {goal.status !== 'COMPLETED' ? (
                <Pressable accessibilityRole="button" onPress={() => void update(goal, { status: 'COMPLETED', progress: 100 })}>
                  <Text style={{ color: colors.primary }}>Complete</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" onPress={() => void update(goal, { progress: Math.min(goal.progress + 10, 100) })}>
                <Text style={{ color: colors.primary }}>+10% progress</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => startEdit(goal)}>
                <Text style={{ color: colors.primary }}>Edit</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => remove(goal)}>
                <Text style={{ color: colors.danger }}>Delete</Text>
              </Pressable>
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, alignItems: 'center', marginTop: 8 },
  track: { height: 8, borderRadius: 8, overflow: 'hidden', marginVertical: 8 },
  progress: { height: 8, borderRadius: 8 },
});
