import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme';

export default function EventLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        presentation: 'modal',
      }}
    />
  );
}
