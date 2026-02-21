import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native'
import { Stack, useSegments, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { View } from 'react-native'
import 'react-native-reanimated'

import AppBottomNav from '@/components/AppBottomNav'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { isAuthenticated } from '@/utils/auth'
import '../global.css'

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    const isLoginScreen = segments[0] === 'login'
    
    if (!isAuthenticated && !isLoginScreen) {
      setTimeout(() => router.replace('/login'), 0)
    } else if (isAuthenticated && isLoginScreen) {
      setTimeout(() => router.replace('/'), 0)
    }
  }, [segments])

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <View className="flex-1">
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#0d1117' },
            headerTintColor: '#e6edf3',
            contentStyle: { backgroundColor: '#0d1117', paddingBottom: 88 },
          }}
        >
          <Stack.Screen name="login" options={{ headerShown: false, contentStyle: { paddingBottom: 0 } }} />
          <Stack.Screen name="index" options={{ title: 'Repositories' }} />
          <Stack.Screen name="files" options={{ title: 'Files' }} />
          <Stack.Screen
            name="source-control"
            options={{ title: 'Source Control' }}
          />
          <Stack.Screen name="history" options={{ title: 'History' }} />
          <Stack.Screen name="testing" options={{ title: 'Test Runner' }} />
          <Stack.Screen name="transfer" options={{ title: 'Transfer' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="repo" options={{ headerShown: false }} />
        </Stack>
        {segments[0] !== 'login' && <AppBottomNav />}
      </View>
      <StatusBar style="light" />
    </ThemeProvider>
  )
}
