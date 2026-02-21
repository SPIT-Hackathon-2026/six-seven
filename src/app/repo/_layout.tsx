import { Stack } from 'expo-router'

export default function RepoLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animationEnabled: true,
      }}
    >
      <Stack.Screen name="[name]/index" options={{ title: 'Repository' }} />
      <Stack.Screen name="[name]/editor" options={{ title: 'Editor' }} />
    </Stack>
  )
}
