import { useCallback, useEffect, useState, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowLeft, Send, Trash2, Clock } from 'lucide-react-native'
import { io, Socket } from 'socket.io-client'
import AsyncStorage from '@react-native-async-storage/async-storage'

import Constants from 'expo-constants'
import { getAuthor } from '@/services/gitService'

// Auto-detect the development machine's IP address for physical devices/emulators
const hostUri = Constants.expoConfig?.hostUri
const fallbackIp = Platform.OS === 'android' ? '10.0.2.2' : 'localhost'
const devIp = hostUri ? hostUri.split(':')[0] : fallbackIp
const BACKEND_URL = process.env.EXPO_PUBLIC_CHAT_API_URL || `http://${devIp}:3000`

type Message = {
  id: number
  repo_id: string
  author_name: string
  text: string
  created_at: string
  client_id?: string
  is_pending?: boolean
}

export default function RepoChatScreen() {
  const router = useRouter()
  const { name } = useLocalSearchParams<{ name: string }>()
  
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  
  const socketRef = useRef<Socket | null>(null)
  const scrollViewRef = useRef<ScrollView>(null)
  const authorName = getAuthor().name || 'Anonymous'
  
  // Unique persistent installation ID per device
  const myClientId = Constants.installationId || Constants.sessionId
  const QUEUE_KEY = `@chat_queue_${name}`

  // Ensure state respects connected status correctly when updating text input
  useEffect(() => {
    if (!name) return

    // 1. Fetch initial history via REST
    fetch(`${BACKEND_URL}/api/chat/${encodeURIComponent(name)}`)
      .then((res) => res.json())
      .then((data: Message[]) => {
        if (Array.isArray(data)) {
          setMessages(data)
        }
      })
      .catch((err) => console.warn('Failed to fetch chat history:', err))
      .finally(() => setLoading(false))

    // 2. Connect to Socket.io
    const socket = io(BACKEND_URL)
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      // Join the repo-specific room
      socket.emit('join_repo', name)
    })

    socket.on('disconnect', () => {
      setConnected(false)
    })

    socket.on('receive_message', (msg: Message) => {
      setMessages((prev) => [...prev, msg])
      // Scroll to bottom on new message
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100)
    })

    socket.on('chat_cleared', () => {
      setMessages([])
    })

    return () => {
      socket.disconnect()
    }
  }, [name, QUEUE_KEY])

  // Sync queue when connection is established
  useEffect(() => {
    if (connected && socketRef.current) {
      AsyncStorage.getItem(QUEUE_KEY).then(queueStr => {
        if (!queueStr) return
        const queue: Message[] = JSON.parse(queueStr)
        if (queue.length > 0) {
          queue.forEach(msg => {
            socketRef.current?.emit('send_message', {
              repoId: name,
              authorName: msg.author_name,
              text: msg.text,
              clientId: msg.client_id,
              clientMsgId: msg.id // Optional: use this to prevent duplicates if server is smart
            })
          })
          AsyncStorage.removeItem(QUEUE_KEY)
          // Update local UI to remove pending flags (server will also broadcast them back)
          setMessages(prev => prev.map(m => m.is_pending ? { ...m, is_pending: false } : m))
        }
      })
    }
  }, [connected, name, QUEUE_KEY])

  const handleSend = useCallback(async () => {
    const text = inputText.trim()
    if (!text || !socketRef.current) return

    setInputText('')

    if (connected) {
      // Emit to server natively
      socketRef.current.emit('send_message', {
        repoId: name,
        authorName,
        text,
        clientId: myClientId,
      })
    } else {
      // Offline: Enqueue locally
      const pendingMsg: Message = {
        id: Date.now(), // Temporary ID
        repo_id: name,
        author_name: authorName,
        text,
        created_at: new Date().toISOString(),
        client_id: myClientId,
        is_pending: true
      }
      
      setMessages(prev => [...prev, pendingMsg])
      
      try {
        const queueStr = await AsyncStorage.getItem(QUEUE_KEY)
        const queue: Message[] = queueStr ? JSON.parse(queueStr) : []
        queue.push(pendingMsg)
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100)
      } catch (err) {
        console.warn('Failed to enqueue message', err)
      }
    }
  }, [inputText, name, authorName, connected, myClientId, QUEUE_KEY])

  const handleClearChat = useCallback(() => {
    if (!name || !connected) return
    fetch(`${BACKEND_URL}/api/chat/${encodeURIComponent(name)}`, { method: 'DELETE' })
      .catch((err) => console.warn('Failed to clear chat:', err))
  }, [name, connected])

  // Scroll to bottom initially
  useEffect(() => {
    if (!loading && messages.length > 0) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 200)
    }
  }, [loading, messages.length])

  return (
    <KeyboardAvoidingView 
      className="flex-1 bg-white dark:bg-black"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View className="pt-14 pb-3 px-5 bg-white dark:bg-zinc-900 border-b border-neutral-200 dark:border-zinc-800">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <TouchableOpacity onPress={() => router.back()} className="p-1 -ml-1">
              <ArrowLeft size={20} color="#8b949e" />
            </TouchableOpacity>
            <View>
              <Text className="text-black dark:text-white text-lg font-bold" numberOfLines={1}>
                Team Chat
              </Text>
              <Text className="text-neutral-500 text-xs font-medium mt-0.5">
                {name}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center gap-4">
            <TouchableOpacity onPress={handleClearChat} className="p-1">
              <Trash2 size={18} color="#f85149" />
            </TouchableOpacity>
            {/* Connection Status Indicator */}
            <View className={`w-2 h-2 rounded-full ${connected ? 'bg-[#3fb950]' : 'bg-[#f85149]'}`} />
          </View>
        </View>
      </View>

      {/* Messages Area */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#58a6ff" />
        </View>
      ) : (
        <ScrollView 
          ref={scrollViewRef}
          className="flex-1 px-4 pt-4"
          contentContainerStyle={{ paddingBottom: 20 }}
        >
          {messages.length === 0 ? (
            <View className="items-center justify-center mt-20">
              <Text className="text-neutral-400 text-sm">No messages yet.</Text>
              <Text className="text-neutral-500 text-xs mt-1">Start the conversation!</Text>
            </View>
          ) : (
            messages.map((msg, idx) => {
              // Now we match on our unique device sessionId, falling back to name if missing (older msgs)
              const isMe = msg.client_id ? msg.client_id === myClientId : msg.author_name === authorName

              // Show name if it's not the user, AND if the previous message was from a DIFFERENT client ID (or if old message, different author name)
              const isDifferentSender = idx === 0 || 
                ((msg.client_id && messages[idx - 1].client_id) 
                  ? messages[idx - 1].client_id !== msg.client_id 
                  : messages[idx - 1].author_name !== msg.author_name)
              
              const showName = isDifferentSender
              
              return (
                <View key={msg.id} className={`mb-3 flex-row ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <View className="max-w-[80%]">
                    {showName && (
                      <Text 
                        className={`text-neutral-500 text-[10px] uppercase font-bold tracking-wider mb-1 ${isMe ? 'text-right mr-1' : 'ml-1'}`}
                      >
                        {msg.author_name}
                      </Text>
                    )}
                    <View 
                      className={`px-4 py-2.5 rounded-2xl ${
                        isMe 
                          ? 'bg-[#1f6feb] rounded-tr-sm' 
                          : 'bg-neutral-100 dark:bg-zinc-800 rounded-tl-sm border border-neutral-200 dark:border-zinc-700'
                      }`}
                    >
                      <View className="flex-row items-end gap-1.5">
                        <Text className={`text-[15px] leading-snug ${isMe ? 'text-white' : 'text-black dark:text-white'}`}>
                          {msg.text}
                        </Text>
                        {msg.is_pending && (
                          <Clock size={10} color="#ffffff88" style={{ marginBottom: 2 }} />
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              )
            })
          )}
        </ScrollView>
      )}

      {/* Input Area */}
      <View className="px-4 py-3 bg-white dark:bg-zinc-900 border-t border-neutral-200 dark:border-zinc-800 flex-row items-end gap-3 pb-8">
        <TextInput
          className="flex-1 min-h-[44px] max-h-[120px] bg-neutral-100 dark:bg-black text-black dark:text-white px-4 py-3 rounded-2xl border border-neutral-200 dark:border-zinc-800 text-[15px]"
          placeholder="Message team..."
          placeholderTextColor="#8b949e"
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity 
          className={`w-11 h-11 rounded-full items-center justify-center ${inputText.trim() ? 'bg-[#2ea043]' : 'bg-neutral-200 dark:bg-zinc-800'}`}
          onPress={handleSend}
          disabled={!inputText.trim()}
        >
          <Send size={18} color={inputText.trim() ? '#fff' : '#8b949e'} style={{ marginLeft: 2 }} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}
