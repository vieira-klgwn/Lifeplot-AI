import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useSchedule } from '../../src/state/schedule';
import { apiRequest, OfflineError } from '../../src/lib/api';
import { Banner, Heading } from '../../src/components/ui';
import type { ChatResponse, Plan } from '../../src/types';

interface Bubble {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  canUndo?: boolean;
  plan?: Plan;
}

function proposedPlan(response: ChatResponse): Plan | undefined {
  const action = response.actions.find((item) => item.tool === 'generate_schedule');
  const data = action?.data;
  if (!data || typeof data !== 'object' || !('plan' in data)) return undefined;
  const plan = data.plan;
  if (!plan || typeof plan !== 'object' || !('revision' in plan) ||
    !('date' in plan) || !('sessions' in plan) || !Array.isArray(plan.sessions) ||
    typeof plan.revision !== 'string' || typeof plan.date !== 'string') return undefined;
  return plan as Plan;
}

const SUGGESTIONS = [
  'What is on my schedule today?',
  'Add a study block tomorrow at 6pm for 2 hours',
  'When am I free for 90 minutes this week?',
];

export default function Chat() {
  const { colors } = useTheme();
  const { refresh } = useSchedule();
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('Checking AI mode…');
  const scrollRef = useRef<ScrollView>(null);

  useFocusEffect(useCallback(() => {
    void apiRequest<{ provider: string; personalKeyConfigured: boolean }>('/ai/provider')
      .then((result) => setProvider(result.provider === 'local' ? 'Mock mode · rule-based assistant' : 'OpenAI connected'))
      .catch(() => setProvider('Assistant unavailable offline'));
  }, []));

  useEffect(() => {
    void (async () => {
      try {
        const { conversation } = await apiRequest<{
          conversation: { id: string; messages: { id: string; role: string; content: string }[] } | null;
        }>('/ai/conversation');
        if (!conversation) return;
        setConversationId(conversation.id);
        setMessages(
          conversation.messages
            .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
            .map((message) => ({
              id: message.id,
              role: message.role === 'USER' ? 'USER' : 'ASSISTANT',
              content: message.content,
            })),
        );
      } catch {
        // A missing history is not worth interrupting the student over.
      }
    })();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setInput('');
      setError(null);
      setBusy(true);
      setMessages((current) => [
        ...current,
        { id: `local-${Date.now()}`, role: 'USER', content: trimmed },
      ]);
      try {
        const reply = await apiRequest<ChatResponse>('/ai/chat', {
          method: 'POST',
          body: { message: trimmed, conversationId },
        });
        setConversationId(reply.conversationId);
        setMessages((current) => [
          ...current,
          { id: reply.messageId, role: 'ASSISTANT', content: reply.reply, canUndo: reply.canUndo, plan: proposedPlan(reply) },
        ]);
        if (reply.actions.some((action) => action.ok)) await refresh();
      } catch (caught) {
        setError(
          caught instanceof OfflineError
            ? 'You are offline. Your schedule is still available, but the assistant needs a connection.'
            : 'The assistant could not answer that. Try again.',
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, refresh],
  );

  const undo = useCallback(
    async (messageId: string) => {
      await apiRequest('/ai/undo', { method: 'POST', body: { messageId } }).catch(() => undefined);
      setMessages((current) =>
        current.map((message) => (message.id === messageId ? { ...message, canUndo: false } : message)),
      );
      await refresh();
    },
    [refresh],
  );

  const approve = async (messageId: string, plan: Plan) => {
    setBusy(true);
    try {
      await apiRequest('/plans/apply', { method: 'POST', body: { date: plan.date, revision: plan.revision } });
      setMessages((current) => current.map((message) => message.id === messageId
        ? { ...message, plan: undefined, content: `${message.content} Plan approved and saved.` } : message));
      await refresh();
    } catch {
      setError('The plan changed. Ask me to plan again before approving.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        >
          <Heading>Plan with LifePilot</Heading>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => {
            setConversationId(undefined);
            setMessages([]);
            setError(null);
          }}>
            <Text style={{ color: colors.primary }}>New conversation</Text>
          </Pressable>
          <Text style={{ color: colors.textMuted }}>
            {provider}
          </Text>

          {messages.length === 0
            ? SUGGESTIONS.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  accessibilityRole="button"
                  onPress={() => void send(suggestion)}
                  style={[styles.suggestion, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <Text style={{ color: colors.text }}>{suggestion}</Text>
                </Pressable>
              ))
            : null}

          {messages.map((message) => (
            <View key={message.id} style={{ gap: 6 }}>
              <View
                style={[
                  styles.bubble,
                  message.role === 'USER'
                    ? { alignSelf: 'flex-end', backgroundColor: colors.primary }
                    : { alignSelf: 'flex-start', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
                ]}
              >
                <Text style={{ color: message.role === 'USER' ? colors.primaryText : colors.text, fontSize: 15 }}>
                  {message.content}
                </Text>
              </View>
              {message.canUndo ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Undo that change"
                  onPress={() => void undo(message.id)}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>Undo</Text>
                </Pressable>
              ) : null}
              {message.plan ? (
                <View style={[styles.suggestion, { backgroundColor: colors.surface, borderColor: colors.border, gap: 10 }]}>
                  {message.plan.sessions.map((session) => (
                    <Text key={`${session.taskId ?? session.goalId}-${session.startTime}`} style={{ color: colors.text }}>
                      {session.title} · {new Date(session.startTime).toLocaleString()}
                    </Text>
                  ))}
                  {message.plan.unscheduled.map((item) => (
                    <Text key={item.taskId ?? item.goalId} style={{ color: colors.warning }}>{item.title}: {item.reason}</Text>
                  ))}
                  {message.plan.sessions.length > 0 ? (
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void approve(message.id, message.plan!)}>
                      <Text style={{ color: colors.primary, fontWeight: '700' }}>Approve and save plan</Text>
                    </Pressable>
                  ) : null}
                  <Pressable accessibilityRole="button" onPress={() => setMessages((current) => current.map((item) =>
                    item.id === message.id ? { ...item, plan: undefined } : item))}>
                    <Text style={{ color: colors.textMuted }}>Dismiss</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}

          {busy ? <ActivityIndicator color={colors.primary} /> : null}
          {error ? <Banner tone="warning" message={error} /> : null}
        </ScrollView>

        <View style={[styles.composer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <TextInput
            accessibilityLabel="Message LifePilot"
            value={input}
            onChangeText={setInput}
            placeholder="Add a meeting tonight at 8…"
            placeholderTextColor={colors.textMuted}
            multiline
            onSubmitEditing={() => void send(input)}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={busy || input.trim().length === 0}
            onPress={() => void send(input)}
            style={[styles.send, { backgroundColor: colors.primary, opacity: input.trim() ? 1 : 0.5 }]}
          >
            <Text style={{ color: colors.primaryText, fontWeight: '700' }}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  thread: { padding: 20, gap: 12 },
  suggestion: { borderRadius: 12, borderWidth: 1, padding: 14 },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, maxHeight: 120, fontSize: 16 },
  send: { borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14, minHeight: 48, justifyContent: 'center' },
});
