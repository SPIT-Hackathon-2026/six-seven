import { View, Text, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';

export default function SettingsScreen() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [autoSync, setAutoSync] = useState(false);

  return (
    <View className="flex-1 bg-[#0d1117]">
      <ScrollView className="flex-1 py-4 px-4">
        
        {/* User Profile Section */}
        <View className="flex-row items-center mb-8 mt-2 p-4 bg-[#161b22] rounded-xl border border-[#30363d]">
          <View className="w-16 h-16 bg-[#3b82f6] rounded-full items-center justify-center mr-4">
            <Text className="text-white text-2xl font-bold">JD</Text>
          </View>
          <View className="flex-1">
            <Text className="text-[#e6edf3] text-xl font-bold">John Doe</Text>
            <Text className="text-[#8b949e] text-sm mt-1">john.doe@example.com</Text>
          </View>
          <TouchableOpacity className="p-2 bg-[#21262d] rounded-lg border border-[#30363d]">
            <Text className="text-[#e6edf3] font-medium text-sm">Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Preferences Section */}
        <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-2 ml-1">
          Preferences
        </Text>
        <View className="bg-[#161b22] rounded-xl border border-[#30363d] mb-6">
          <View className="flex-row items-center justify-between p-4 border-b border-[#30363d]">
            <View className="flex-row items-center">
              <View className="bg-[#21262d] p-2 rounded-lg mr-3">
                <Ionicons name="moon" size={20} color="#e6edf3" />
              </View>
              <Text className="text-[#e6edf3] text-base font-medium">Dark Mode</Text>
            </View>
            <Switch
              value={isDarkMode}
              onValueChange={setIsDarkMode}
              trackColor={{ false: '#30363d', true: '#2ea043' }}
              thumbColor={'#ffffff'}
            />
          </View>

          <View className="flex-row items-center justify-between p-4 border-b border-[#30363d]">
            <View className="flex-row items-center">
              <View className="bg-[#21262d] p-2 rounded-lg mr-3">
                <Ionicons name="sync" size={20} color="#e6edf3" />
              </View>
              <Text className="text-[#e6edf3] text-base font-medium">Auto Sync on Wi-Fi</Text>
            </View>
            <Switch
              value={autoSync}
              onValueChange={setAutoSync}
              trackColor={{ false: '#30363d', true: '#2ea043' }}
              thumbColor={'#ffffff'}
            />
          </View>

          <TouchableOpacity className="flex-row items-center justify-between p-4">
            <View className="flex-row items-center">
              <View className="bg-[#21262d] p-2 rounded-lg mr-3">
                <Ionicons name="notifications" size={20} color="#e6edf3" />
              </View>
              <Text className="text-[#e6edf3] text-base font-medium">Notifications</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#8b949e" />
          </TouchableOpacity>
        </View>

        {/* Data & Storage Section */}
        <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-2 ml-1">
          Data & Storage
        </Text>
        <View className="bg-[#161b22] rounded-xl border border-[#30363d] mb-6">
          <TouchableOpacity className="flex-row items-center justify-between p-4 border-b border-[#30363d]">
            <View className="flex-row items-center">
              <View className="bg-[#21262d] p-2 rounded-lg mr-3">
                <Ionicons name="folder" size={20} color="#e6edf3" />
              </View>
              <Text className="text-[#e6edf3] text-base font-medium">Local Repositories</Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-[#8b949e] mr-2">1.2 GB</Text>
              <Ionicons name="chevron-forward" size={20} color="#8b949e" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity className="flex-row items-center justify-between p-4">
            <View className="flex-row items-center">
              <View className="bg-[#21262d] p-2 rounded-lg mr-3">
                <Ionicons name="trash" size={20} color="#ef4444" />
              </View>
              <Text className="text-[#ef4444] text-base font-medium">Clear Cache</Text>
            </View>
            <Text className="text-[#8b949e]">256 MB</Text>
          </TouchableOpacity>
        </View>

        {/* About Section */}
        <Text className="text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-2 ml-1">
          About
        </Text>
        <View className="bg-[#161b22] rounded-xl border border-[#30363d] mb-8">
          <TouchableOpacity className="flex-row items-center justify-between p-4 border-b border-[#30363d]">
            <Text className="text-[#e6edf3] text-base font-medium">Help & Documentation</Text>
            <Ionicons name="chevron-forward" size={20} color="#8b949e" />
          </TouchableOpacity>
          <View className="flex-row items-center justify-between p-4">
            <Text className="text-[#e6edf3] text-base font-medium">Version</Text>
            <Text className="text-[#8b949e]">1.0.0 (Beta)</Text>
          </View>
        </View>

        {/* Logout Button */}
        <TouchableOpacity className="bg-[#21262d] py-4 rounded-xl items-center justify-center border border-[#ef4444]/30 mb-12">
          <Text className="text-[#ef4444] font-bold text-base">Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}
