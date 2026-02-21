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
      <Stack.Screen
        name="[name]/conflicts"
        options={{ title: 'Merge Conflicts' }}
      />
      <Stack.Screen
        name="[name]/compare"
        options={{ title: 'Compare Branches' }}
      />
    </Stack>
  )
}
