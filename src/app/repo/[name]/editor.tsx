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

import { readFile, writeFile, fileExists } from '@/services/fileService'
import { stageFile, getFileStatus, diffFile, readFileAtRef, isSparseRepo } from '@/services/gitService'

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
        let text: string
        const exists = await fileExists(name, file)
        if (exists) {
          // Normal repo: file already on disk
          text = await readFile(name, file)
        } else {
          // Sparse/lazy repo: read from git blob store, then materialize to disk
          const sparse = await isSparseRepo(name)
          if (sparse) {
            text = await readFileAtRef(name, file, 'HEAD')
            // Write to disk so stageFile + writeFile work normally after editing
            await writeFile(name, file, text)
          } else {
            text = await readFile(name, file) // will throw with a clear error
          }
        }
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
      <View className="flex-1 bg-neutral-100 dark:bg-black items-center justify-center">
        <Text className="text-black dark:text-neutral-100">Invalid file parameters</Text>
      </View>
    )
  }

  if (loading) {
    return (
      <View className="flex-1 bg-neutral-100 dark:bg-black items-center justify-center">
        <ActivityIndicator color="#58a6ff" />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-neutral-100 dark:bg-black">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-14 pb-4 border-b border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 ">
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
          className="p-2 -ml-2"
        >
          <Text className="text-[#58a6ff] text-base font-bold tracking-wide">‹ Back</Text>
        </TouchableOpacity>

        <View className="flex-1 items-center mx-3 mt-1">
          <Text className="text-black dark:text-neutral-100 text-[15px] font-bold tracking-wide" numberOfLines={1}>
            {file.split('/').pop()}
          </Text>
          {status ? (
            <Text className="text-neutral-500 text-[10px] uppercase font-bold tracking-wider mt-0.5">{status}</Text>
          ) : null}
        </View>

        <View className="flex-row gap-4">
          <TouchableOpacity onPress={handleDiff} className="p-2 -mr-2">
            <Text className="text-neutral-500 text-sm font-bold tracking-wide">Diff</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSave} disabled={saving} className="p-2 -mr-2">
            <Text className={`text-sm font-bold tracking-wide ${saving ? 'text-neutral-400' : 'text-[#58a6ff]'}`}>
              {saving ? 'Saving...' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Diff overlay */}
      {showDiff ? (
        <View className="flex-1 bg-white dark:bg-black z-10">
          <View className="flex-row items-center justify-between px-5 py-3 bg-neutral-100 dark:bg-black border-b border-neutral-200 dark:border-zinc-800">
            <Text className="text-black dark:text-neutral-100 text-sm font-bold uppercase tracking-wider">Diff</Text>
            <TouchableOpacity onPress={() => setShowDiff(false)}>
              <Text className="text-[#58a6ff] text-sm font-bold tracking-wide">Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 p-5">
            <Text
              className="text-neutral-700 dark:text-neutral-300 text-[13px] leading-relaxed"
              style={{ fontFamily: 'monospace' }}
            >
              {diffText}
            </Text>
          </ScrollView>
        </View>
      ) : (
        <>
          <ScrollView className="flex-1 bg-white dark:bg-black" keyboardShouldPersistTaps="always">
            <TextInput
              className="text-black dark:text-neutral-200 text-[13px] p-5 leading-relaxed"
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
          <View className="flex-row items-center justify-between px-5 py-3 border-t border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 ">
            <Text className="text-neutral-500 text-[11px] font-mono tracking-wider flex-1 mr-4" numberOfLines={1}>
              {file}
            </Text>
            {hasChanges && (
              <View className="flex-row gap-2">
                <TouchableOpacity
                  className="px-4 py-2 rounded-lg bg-[#238636]/10 border border-[#238636]/30 "
                  onPress={handleSaveAndStage}
                  disabled={saving}
                >
                  <Text className="text-[#238636] dark:text-[#7ee787] text-[11px] font-bold uppercase tracking-wider">
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
