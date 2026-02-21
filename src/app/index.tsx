import { View, Text, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'

export default function HomeScreen() {
  const router = useRouter()

  return (
    <View className="flex-1 bg-[#0d1117] items-center justify-center gap-3">
      <Text className="text-[#e6edf3] text-2xl font-bold mb-6">
        Hello World
      </Text>
      <TouchableOpacity
        className="bg-[#21262d] border border-[#30363d] px-4 py-2 rounded-lg"
        onPress={() => router.push('/transfer')}
      >
        <Text className="text-[#58a6ff] text-sm">Transfer Repos →</Text>
      </TouchableOpacity>
      <TouchableOpacity
        className="bg-[#21262d] border border-[#30363d] px-4 py-2 rounded-lg"
        onPress={() => router.push('/testing')}
      >
        <Text className="text-[#58a6ff] text-sm">Run Tests →</Text>
      </TouchableOpacity>
    </View>
  )
}
