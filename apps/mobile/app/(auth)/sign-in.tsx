import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/state/auth';
import { Banner, Button, Field, Heading } from '../../src/components/ui';
import { ApiError, OfflineError } from '../../src/lib/api';

export default function SignIn() {
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      setError(
        caught instanceof OfflineError
          ? 'No connection. Check your network and try again.'
          : caught instanceof ApiError
            ? caught.message
            : 'Could not sign in.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Heading>UniFlow</Heading>
            <Text style={{ color: colors.textMuted, fontSize: 16 }}>
              Talk to your schedule instead of managing it.
            </Text>
          </View>

          {error ? <Banner tone="danger" message={error} /> : null}

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@university.edu"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            placeholder="Your password"
          />
          <Button label="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />

          <Link href="/(auth)/sign-up" style={[styles.link, { color: colors.primary }]}>
            New here? Create an account
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16, flexGrow: 1, justifyContent: 'center' },
  header: { gap: 8, marginBottom: 8 },
  link: { textAlign: 'center', fontWeight: '600', paddingVertical: 12 },
});
