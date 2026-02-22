import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, SafeAreaView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Mail, Lock } from 'lucide-react-native';
import { setAuthenticated } from '@/utils/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('user@gmail.com');
  const [password, setPassword] = useState('password123');
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
      <View className="flex-1 px-6 justify-center pb-10">
        <View className="items-center  mb-4">
          <Image
            source={require('@/assets/images/logo.png')}
            style={{ width: 260, height: 260, marginBottom: -50 }}
            resizeMode="contain"
          />
          <Text className="text-black dark:text-white text-3xl font-bold">Welcome to GitLane</Text>
        </View>

          <TouchableOpacity 
            className="bg-[#238636] py-3.5 rounded-lg items-center mt-4 border border-[#2ea043]"
            onPress={handleLogin}
          >
            <Text className="text-white text-base font-bold text-center">Continue</Text>
          </TouchableOpacity>
        </View>
    </SafeAreaView>
  );
}
