import { View, Text, TouchableOpacity } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BookMarked, FolderTree, GitMerge, Clock, Settings } from 'lucide-react-native'

const tabs = [
  { label: 'Repositories', icon: BookMarked, route: '/' },
  { label: 'Files', icon: FolderTree, route: '/files' },
  { label: 'Source Control', icon: GitMerge, route: '/source-control' },
  { label: 'History', icon: Clock, route: '/history' },
  { label: 'Settings', icon: Settings, route: '/settings' },
] as const

export default function AppBottomNav() {
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()

  return (
    <View
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
      className="absolute bottom-0 left-0 right-0 border-t border-[#30363d] bg-[#0d1117] px-2 pt-2"
    >
      <View className="flex-row items-center justify-between">
        {tabs.map((tab) => {
          const active = pathname === tab.route
          return (
            <TouchableOpacity
              key={tab.route}
              className="flex-1 items-center py-1.5"
              onPress={() => router.push(tab.route as any)}
            >
              <tab.icon size={22} color={active ? '#58a6ff' : '#8b949e'} />
              <Text
                numberOfLines={1}
                className={
                  active
                    ? 'text-[#e6edf3] text-[11px] mt-0.5'
                    : 'text-[#8b949e] text-[11px] mt-0.5'
                }
              >
                {tab.label}
              </Text>
              {active && <View className="mt-1 h-0.5 w-7 rounded-full bg-[#58a6ff]" />}
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}
