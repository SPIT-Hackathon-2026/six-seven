import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { readFile, writeFile } from '@/services/fileService'
import { stageFile, getFileStatus, diffFile } from '@/services/gitService'

export default function EditorScreen() {
  const router = useRouter()
  const { name, file } = useLocalSearchParams<{ name: string; file: string }>()
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [diffText, setDiffText] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!name || !file) return
    ;(async () => {
      setLoading(true)
      try {
        const text = await readFile(name, file)
        setContent(text)
        setOriginalContent(text)
        const stat = await getFileStatus(name, file).catch(() => null)
        if (stat) setStatus(stat)
      } catch (err: any) {
        Alert.alert('Error', err?.message ?? 'Cannot read file')
      } finally {
        setLoading(false)
      }
    })()
  }, [name, file])

  const hasChanges = content !== originalContent

  const handleSave = useCallback(async () => {
    if (!name || !file) return
    setSaving(true)
    try {
      await writeFile(name, file, content)
      setOriginalContent(content)
      Alert.alert('Saved', file)
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? '')
    } finally {
      setSaving(false)
    }
  }, [name, file, content])

  const handleSaveAndStage = useCallback(async () => {
    if (!name || !file) return
    setSaving(true)
    try {
      await writeFile(name, file, content)
      await stageFile(name, file)
      setOriginalContent(content)
      Alert.alert('Saved & Staged', file)
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? '')
    } finally {
      setSaving(false)
    }
  }, [name, file, content])

  const handleDiff = useCallback(async () => {
    if (!name || !file) return
    try {
      const result = await diffFile(name, file)
      if (typeof result === 'string') {
        setDiffText(result || '(no changes)')
      } else if (result) {
        setDiffText(
          `--- a/${file}\n+++ b/${file}\n\nOld:\n${result.oldContent ?? '(empty)'}\n\nNew:\n${result.newContent ?? '(empty)'}`,
        )
      } else {
        setDiffText('(new file)')
      }
      setShowDiff(true)
    } catch {
      setDiffText('Could not generate diff')
      setShowDiff(true)
    }
  }, [name, file])

  if (!name || !file) {
    return (
      <View className="flex-1 bg-[#0d1117] items-center justify-center">
        <Text className="text-[#e6edf3]">Invalid file parameters</Text>
      </View>
    )
  }

  if (loading) {
    return (
      <View className="flex-1 bg-[#0d1117] items-center justify-center">
        <ActivityIndicator color="#58a6ff" />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-[#0d1117]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-[#30363d]">
        <TouchableOpacity
          onPress={() => {
            if (hasChanges) {
              Alert.alert('Unsaved changes', 'Discard changes?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Discard',
                  style: 'destructive',
                  onPress: () => router.back(),
                },
              ])
            } else {
              router.back()
            }
          }}
        >
          <Text className="text-[#58a6ff] text-base font-semibold">‹ Back</Text>
        </TouchableOpacity>

        <View className="flex-1 items-center mx-2">
          <Text className="text-[#e6edf3] text-sm font-bold" numberOfLines={1}>
            {file.split('/').pop()}
          </Text>
          {status ? (
            <Text className="text-[#8b949e] text-[10px]">{status}</Text>
          ) : null}
        </View>

        <View className="flex-row gap-2">
          <TouchableOpacity onPress={handleDiff}>
            <Text className="text-[#8b949e] text-sm">Diff</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            <Text className="text-[#58a6ff] text-sm font-semibold">
              {saving ? '...' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Diff overlay */}
      {showDiff ? (
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d]">
            <Text className="text-[#e6edf3] text-sm font-semibold">Diff</Text>
            <TouchableOpacity onPress={() => setShowDiff(false)}>
              <Text className="text-[#58a6ff] text-sm">Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 p-4">
            <Text
              className="text-[#c9d1d9] text-xs"
              style={{ fontFamily: 'monospace' }}
            >
              {diffText}
            </Text>
          </ScrollView>
        </View>
      ) : (
        <>
          <ScrollView className="flex-1" keyboardShouldPersistTaps="always">
            <TextInput
              className="text-[#c9d1d9] text-sm p-4"
              style={{ fontFamily: 'monospace', minHeight: 400 }}
              value={content}
              onChangeText={setContent}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              scrollEnabled={false}
            />
          </ScrollView>

          {/* Footer */}
          <View className="flex-row items-center justify-between px-4 py-2 border-t border-[#30363d]">
            <Text className="text-[#484f58] text-xs flex-1" numberOfLines={1}>
              {file}
            </Text>
            {hasChanges && (
              <View className="flex-row gap-2">
                <TouchableOpacity
                  className="px-3 py-1.5 rounded-md bg-[#21262d]"
                  onPress={handleSaveAndStage}
                  disabled={saving}
                >
                  <Text className="text-[#7ee787] text-xs font-semibold">
                    Save & Stage
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </>
      )}
    </View>
  )
}
