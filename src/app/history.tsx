import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';

export default function HistoryScreen() {
  const router = useRouter();

  const dummyCommits = [
    { id: '1', message: "Fix login issue", hash: "4be7d2", time: "2 hours ago", color: "bg-[#3b82f6]" },
    { id: '2', message: "Add new feature", hash: "b2c34", time: "1 day ago", color: "bg-[#22c55e]" },
    { id: '3', message: "Initial commit", hash: "a1bxc3", time: "5 days ago", color: "bg-[#ef4444]" },
  ];

  return (
    <View className="flex-1 bg-[#0d1117]">
      <ScrollView className="flex-1 px-4 pt-2" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Graph Mockup Visualization */}
        <View className="h-36 mb-8 mt-4 relative bg-[#0d1117]">
          
          {/* Blue Line Main Branch */}
          <View className="absolute top-4 left-[5%] right-[5%] h-1 bg-[#3b82f6] opacity-80" />
          
          {/* Blue Nodes */}
          <View className="absolute top-[12px] left-[5%] w-3 h-3 rounded-full bg-[#3b82f6] shadow-sm shadow-[#3b82f6]" />
          <View className="absolute top-[12px] right-[5%] w-3 h-3 rounded-full bg-[#3b82f6]" />
          
          {/* Green Line Branching Down */}
          <View className="absolute top-[20px] left-[15%] w-4 h-10 border-l-2 border-b-2 border-[#22c55e] border-opacity-80 rounded-bl-xl" />
          <View className="absolute top-[58px] left-[15%] ml-4 w-[60%] h-1 bg-[#22c55e] opacity-80" />
          <View className="absolute top-[20px] left-[65%] w-4 h-10 border-r-2 border-b-2 border-[#22c55e] border-opacity-80 rounded-br-xl mt-[0px]" />

          {/* Green Node */}
          <View className="absolute top-[55px] left-[35%] w-3 h-3 rounded-full bg-[#22c55e]" />

          {/* Red Line Branching Further Down */}
          <View className="absolute top-[62px] left-[25%] w-4 h-[44px] border-l-2 border-b-2 border-[#ef4444] border-opacity-80 rounded-bl-xl" />
          <View className="absolute top-[104px] left-[25%] ml-4 w-[30%] h-1 bg-[#ef4444] opacity-80" />
          
          {/* Red Node */}
          <View className="absolute top-[101px] left-[30%] w-3 h-3 rounded-full bg-[#ef4444]" />
        </View>

        {/* Commits List */}
        <View className="px-2">
          {dummyCommits.map((commit, index) => (
            <View key={commit.id} className="flex-row items-center mb-7 w-full relative">
              {/* Branch Color Node */}
              <View className="mr-6 self-start mt-1.5 items-center justify-center z-10">
                <View className={`w-3.5 h-3.5 rounded-full ${commit.color}`} />
              </View>

              {/* Commit Details Row */}
              <View className="flex-1 flex-row items-center justify-between border-b pb-4 border-[#30363d]/50">
                <Text className="text-[#e6edf3] text-base font-semibold flex-1">
                  {commit.message}
                </Text>
                
                <View className="flex-row items-center">
                  <Text className="text-[#8b949e] font-mono text-sm mr-3">
                    {commit.hash}
                  </Text>
                  <Text className="text-[#8b949e] text-xs">
                    {commit.time}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
