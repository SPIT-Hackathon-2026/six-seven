import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, TextInput, FlatList } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Trash2, Edit3, GripVertical, CheckCircle2, Combine } from 'lucide-react-native';
import { getLog, interactiveRebase } from '@/services/gitService';

type RebaseAction = 'pick' | 'drop' | 'squash' | 'reword';

interface ActionItem {
  oid: string;
  originalMessage: string;
  author: string;
  action: RebaseAction;
  newMessage?: string;
  isExpanded?: boolean;
}

export default function RebaseScreen() {
  const router = useRouter();
  const { name, baseOid } = useLocalSearchParams<{ name: string; baseOid: string }>();

  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [commits, setCommits] = useState<ActionItem[]>([]);

  // Load the commits between HEAD and the baseOid
  useEffect(() => {
    async function load() {
      if (!name || !baseOid) return;
      try {
        const log = await getLog(name, { depth: 50 });
        const toRebase: ActionItem[] = [];
        for (const entry of log) {
          if (entry.oid === baseOid) break; // Stop at the base
          toRebase.push({
            oid: entry.oid,
            originalMessage: entry.commit.message,
            author: entry.commit.author.name,
            action: 'pick', // default
          });
        }
        // interactive rebase requires oldest-first ordering
        toRebase.reverse();
        setCommits(toRebase);
      } catch (err: any) {
        Alert.alert('Error loading history', err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [name, baseOid]);

  const handleApply = async () => {
    if (!name || !baseOid) return;
    setApplying(true);
    try {
      // Execute the offline git interactive rebase script
      await interactiveRebase(name, baseOid, commits);
      Alert.alert('Success', 'Repository history successfully rewritten!', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (err: any) {
      Alert.alert('Rebase Failed', err.message);
    } finally {
      setApplying(false);
    }
  };

  const updateAction = (index: number, action: RebaseAction) => {
    const newCommits = [...commits];
    newCommits[index].action = action;
    if (action === 'reword') {
      newCommits[index].isExpanded = true;
      newCommits[index].newMessage = newCommits[index].newMessage || newCommits[index].originalMessage;
    } else {
      newCommits[index].isExpanded = false;
    }
    setCommits(newCommits);
  };

  const updateMessage = (index: number, text: string) => {
    const newCommits = [...commits];
    newCommits[index].newMessage = text;
    setCommits(newCommits);
  };

  const moveItemUp = (index: number) => {
    if (index === 0) return;
    const newCommits = [...commits];
    const temp = newCommits[index];
    newCommits[index] = newCommits[index - 1];
    newCommits[index - 1] = temp;
    setCommits(newCommits);
  };

  const moveItemDown = (index: number) => {
    if (index === commits.length - 1) return;
    const newCommits = [...commits];
    const temp = newCommits[index];
    newCommits[index] = newCommits[index + 1];
    newCommits[index + 1] = temp;
    setCommits(newCommits);
  };

  if (loading) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-black items-center justify-center">
        <ActivityIndicator color="#58a6ff" size="large" />
      </View>
    );
  }

  if (commits.length === 0) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-black">
        <View className="p-4 flex-row items-center border-b border-neutral-200 dark:border-zinc-800">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <ArrowLeft color="#8b949e" size={24} />
          </TouchableOpacity>
          <Text className="text-black dark:text-white text-lg font-bold">Interactive Rebase</Text>
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-neutral-500 text-center">
            You selected the current HEAD as the base. There are no commits to rebase.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      {/* Header */}
      <View className="pt-12 pb-4 px-4 bg-white dark:bg-zinc-900 border-b border-neutral-200 dark:border-zinc-800 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1 rounded-full bg-neutral-100 dark:bg-zinc-800">
            <ArrowLeft color="#58a6ff" size={20} />
          </TouchableOpacity>
          <View>
            <Text className="text-black dark:text-white text-lg font-bold">Interactive Rebase</Text>
            <Text className="text-neutral-500 text-xs">Onto {baseOid.slice(0,7)}</Text>
          </View>
        </View>
        <TouchableOpacity
          className={`px-4 py-2 ${applying ? 'bg-[#2ea043]/50' : 'bg-[#2ea043]'} rounded-lg flex-row items-center`}
          onPress={handleApply}
          disabled={applying}
        >
          {applying ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text className="text-white font-bold text-sm">Apply</Text>
          )}
        </TouchableOpacity>
      </View>

      <View className="flex-1 px-4 py-6">
        <Text className="text-neutral-500 text-sm mb-4 bg-[#58a6ff]/10 p-3 rounded-lg border border-[#58a6ff]/20 text-[#58a6ff]">
          Order is oldest to newest. Actions run from top to bottom.
        </Text>

        <View className="bg-white dark:bg-zinc-900 rounded-xl border border-neutral-200 dark:border-zinc-800 overflow-hidden flex-1">
          <FlatList
            data={commits}
            keyExtractor={(item) => item.oid}
            contentContainerStyle={{ paddingBottom: 48 }}
            renderItem={({ item, index }) => {
              const isDropped = item.action === 'drop';
              const isSquash = item.action === 'squash';
              
              return (
                <View 
                  style={[{ flexDirection: 'row', padding: 12, borderBottomWidth: 1, borderColor: '#f4f4f5' }, isDropped ? { opacity: 0.4 } : {}]}
                >
                  {/* Manual Reorder Buttons */}
                  <View style={{ justifyContent: 'center', marginRight: 12 }}>
                      <TouchableOpacity onPress={() => moveItemUp(index)} disabled={index === 0} style={{ marginBottom: 8 }}>
                          <ArrowLeft size={16} color={index === 0 ? 'transparent' : '#8b949e'} style={{ transform: [{ rotate: '90deg' }] }} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => moveItemDown(index)} disabled={index === commits.length - 1}>
                          <ArrowLeft size={16} color={index === commits.length - 1 ? 'transparent' : '#8b949e'} style={{ transform: [{ rotate: '-90deg' }] }} />
                      </TouchableOpacity>
                  </View>

                  <View style={{ flex: 1, justifyContent: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ color: '#737373', fontFamily: 'monospace', fontSize: 12, marginRight: 8 }}>{item.oid.slice(0,7)}</Text>
                        {isSquash ? (
                          <View style={{ backgroundColor: 'rgba(210, 168, 255, 0.2)', paddingHorizontal: 8, borderRadius: 4, flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
                              <Combine size={10} color="#d2a8ff" style={{ marginRight: 4 }} />
                              <Text style={{ color: '#d2a8ff', fontSize: 10, fontWeight: 'bold' }}>Squash into ↑</Text>
                          </View>
                        ) : null}
                      </View>
                      
                      {/* Action Selector */}
                      <View style={{ flexDirection: 'row', backgroundColor: '#f5f5f5', borderRadius: 8, padding: 2 }}>
                        {item.action === 'pick' || item.action === 'reword' ? (
                          <TouchableOpacity style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#ffffff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }} onPress={() => updateAction(index, 'pick')}>
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#000000' }}>Pick</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }} onPress={() => updateAction(index, 'pick')}>
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#000000' }}>Pick</Text>
                          </TouchableOpacity>
                        )}
                        
                        {item.action === 'squash' ? (
                          <TouchableOpacity style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(210, 168, 255, 0.2)', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }} onPress={() => updateAction(index, 'squash')} disabled={index === 0}>
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#d2a8ff' }}>Squash</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }} onPress={() => updateAction(index, 'squash')} disabled={index === 0}>
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: index === 0 ? '#a3a3a3' : '#737373' }}>Squash</Text>
                          </TouchableOpacity>
                        )}

                        {item.action === 'drop' ? (
                          <TouchableOpacity style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(248, 81, 73, 0.2)', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }} onPress={() => updateAction(index, 'drop')}>
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#f85149' }}>Drop</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, flexDirection: 'row', alignItems: 'center' }} onPress={() => updateAction(index, 'drop')}>
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#737373' }}>Drop</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    <Text 
                      style={[{ color: '#000000', fontSize: 14, fontWeight: '500' }, isDropped ? { textDecorationLine: 'line-through', textDecorationColor: '#f85149' } : {}]}
                      numberOfLines={item.isExpanded ? undefined : 1}
                    >
                      {item.originalMessage.trim()}
                    </Text>

                    {/* Reword UI */}
                    {item.action === 'pick' && !isDropped ? (
                      <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' }}>
                        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => updateAction(index, 'reword')}>
                            <Edit3 size={12} color="#58a6ff" />
                            <Text style={{ color: '#58a6ff', fontSize: 11, fontWeight: 'bold', marginLeft: 4 }}>Reword</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    {item.action === 'reword' ? (
                      <View style={{ marginTop: 8 }}>
                        <TextInput
                            style={{ backgroundColor: '#fafafa', color: '#000000', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#e5e5e5', fontSize: 12 }}
                            value={item.newMessage}
                            onChangeText={(text) => updateMessage(index, text)}
                            multiline
                        />
                        <TouchableOpacity 
                            style={{ marginTop: 8, alignSelf: 'flex-end', backgroundColor: '#e5e5e5', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 4 }}
                            onPress={() => {
                                const newC = [...commits]
                                newC[index].isExpanded = false
                                setCommits(newC)
                            }}
                        >
                            <Text style={{ color: '#404040', fontSize: 10, fontWeight: 'bold' }}>Done</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                  </View>
                </View>
              );
            }}
          />
        </View>
      </View>
    </View>
  );
}
