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
      <Stack.Screen name="[name]/graph" options={{ title: 'Branch Graph' }} />
      <Stack.Screen name="[name]/analytics" options={{ title: 'Analytics' }} />
      <Stack.Screen name="[name]/health" options={{ title: 'Health' }} />
      <Stack.Screen name="[name]/user-profile" options={{ title: 'User Profile' }} />
    </Stack>
  )
}
