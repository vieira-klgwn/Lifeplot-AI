import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/state/auth';
import { Banner, Button, Field, Heading } from '../../src/components/ui';
import { ApiError, OfflineError } from '../../src/lib/api';

export default function SignUp() {
  const { colors } = useTheme();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [university, setUniversity] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signUp({
        name: name.trim(),
        email: email.trim(),
        password,
        university: university.trim() || undefined,
      });
    } catch (caught) {
      setError(
        caught instanceof OfflineError
          ? 'No connection. Check your network and try again.'
          : caught instanceof ApiError
            ? caught.message
            : 'Could not create your account.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Heading>Create your account</Heading>
          <Text style={{ color: colors.textMuted }}>Your schedule stays private to you.</Text>

          {error ? <Banner tone="danger" message={error} /> : null}

          <Field label="Name" value={name} onChangeText={setName} placeholder="Alex Doe" />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@university.edu"
          />
          <Field
            label="University (optional)"
            value={university}
            onChangeText={setUniversity}
            placeholder="NYU"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="At least 10 characters"
          />
          <Button
            label="Create account"
            onPress={submit}
            loading={busy}
            disabled={!name || !email || password.length < 10}
          />

          <Link href="/(auth)/sign-in" style={[styles.link, { color: colors.primary }]}>
            I already have an account
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16, flexGrow: 1, justifyContent: 'center' },
  link: { textAlign: 'center', fontWeight: '600', paddingVertical: 12 },
});
