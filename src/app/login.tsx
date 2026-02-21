import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { setAuthenticated } from '@/utils/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleLogin = () => {
    if (!email.trim().toLowerCase().includes('gmail.com')) {
      Alert.alert('Invalid Email', 'Please use a Gmail address to log in.');
      return;
    }
    if (password.trim() === '') {
      Alert.alert('Required', 'Please enter your password.');
      return;
    }
    
    // Simulate Login Success
    setAuthenticated(true);
    router.replace('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0d1117]">
      <View className="flex-1 px-6 justify-center pb-12">
        <View className="items-center mb-10">
          <View className="w-20 h-20 bg-[#21262d] rounded-2xl items-center justify-center border border-[#30363d] mb-4">
            <Ionicons name="git-branch" size={40} color="#58a6ff" />
          </View>
          <Text className="text-[#f0f6fc] text-3xl font-bold">Welcome to GitLane</Text>
          <Text className="text-[#8b949e] text-base mt-2">Sign in to sync your repositories</Text>
        </View>

        <View className="space-y-4 gap-4">
          <View>
            <Text className="text-[#c9d1d9] text-sm font-semibold mb-2">Email Address</Text>
            <View className="flex-row items-center bg-[#161b22] border border-[#30363d] rounded-lg px-3">
              <Ionicons name="mail" size={20} color="#8b949e" />
              <TextInput
                className="flex-1 text-[#e6edf3] py-3 px-3 text-base"
                placeholder="user@gmail.com"
                placeholderTextColor="#484f58"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>
          </View>

          <View>
            <Text className="text-[#c9d1d9] text-sm font-semibold mb-2">Password</Text>
            <View className="flex-row items-center bg-[#161b22] border border-[#30363d] rounded-lg px-3">
              <Ionicons name="lock-closed" size={20} color="#8b949e" />
              <TextInput
                className="flex-1 text-[#e6edf3] py-3 px-3 text-base"
                placeholder="••••••••"
                placeholderTextColor="#484f58"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>
          </View>

          <TouchableOpacity 
            className="bg-[#238636] py-3.5 rounded-lg items-center mt-4 border border-[#2ea043]"
            onPress={handleLogin}
          >
            <Text className="text-white text-base font-bold text-center">Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
