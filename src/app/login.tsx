import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { GitBranch, Mail, Lock } from 'lucide-react-native';
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
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="flex-1 px-6 justify-center pb-12">
        <View className="items-center mb-10">
          <View className="w-20 h-20 bg-neutral-100 dark:bg-zinc-900 rounded-2xl items-center justify-center border border-neutral-200 dark:border-zinc-800 mb-4">
            <GitBranch size={40} color="#58a6ff" />
          </View>
          <Text className="text-black dark:text-white text-3xl font-bold">Welcome to GitLane</Text>
          <Text className="text-neutral-500 text-base mt-2">Sign in to sync your repositories</Text>
        </View>

        <View className="space-y-4 gap-4">
          <View>
            <Text className="text-neutral-500 text-sm font-semibold mb-2">Email Address</Text>
            <View className="flex-row items-center bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 rounded-lg px-3">
              <Mail size={20} color="#8b949e" />
              <TextInput
                className="flex-1 text-black dark:text-white py-3 px-3 text-base"
                placeholder="user@gmail.com"
                placeholderTextColor="#8b949e"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>
          </View>

          <View>
            <Text className="text-neutral-500 text-sm font-semibold mb-2">Password</Text>
            <View className="flex-row items-center bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800 rounded-lg px-3">
              <Lock size={20} color="#8b949e" />
              <TextInput
                className="flex-1 text-black dark:text-white py-3 px-3 text-base"
                placeholder="••••••••"
                placeholderTextColor="#8b949e"
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
