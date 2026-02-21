/**
 * TestRunner screen — run & display offline Git test results.
 *
 * Add to your navigation or simply import into any existing screen:
 *
 *   import TestRunner from '../components/TestRunner'
 *   // then render <TestRunner /> somewhere
 */

import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { runAllTests } from '../__tests__/offlineGitTests'

export default function TestRunner() {
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState(null)
  const [details, setDetails] = useState([])

  const handleRun = useCallback(async () => {
    setRunning(true)
    setSummary(null)
    setDetails([])
    try {
      const result = await runAllTests()
      setSummary(result)
      setDetails(result.details)
    } catch (err) {
      setSummary({ pass: 0, fail: 1, total: 1, elapsed: '0', details: [] })
      setDetails([{ status: 'FAIL', description: `Runner crashed: ${err.message}` }])
    } finally {
      setRunning(false)
    }
  }, [])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Offline Git — Test Runner</Text>

      <TouchableOpacity
        style={[styles.button, running && styles.buttonDisabled]}
        onPress={handleRun}
        disabled={running}
      >
        {running ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Run All Tests</Text>
        )}
      </TouchableOpacity>

      {summary && (
        <View style={[styles.summaryBox, summary.fail > 0 ? styles.summaryFail : styles.summaryPass]}>
          <Text style={styles.summaryText}>
            {summary.pass} passed  ·  {summary.fail} failed  ·  {summary.total} total  ·  {summary.elapsed}s
          </Text>
        </View>
      )}

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
        {details.map((d, i) => (
          <View
            key={i}
            style={[styles.row, d.status === 'PASS' ? styles.rowPass : styles.rowFail]}
          >
            <Text style={styles.icon}>{d.status === 'PASS' ? '✅' : '❌'}</Text>
            <Text style={styles.desc} numberOfLines={2}>
              {d.description}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117', padding: 16, paddingTop: 48 },
  title: { color: '#e6edf3', fontSize: 20, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  button: {
    backgroundColor: '#238636',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  summaryBox: { padding: 12, borderRadius: 8, marginBottom: 12 },
  summaryPass: { backgroundColor: '#1a3a1a' },
  summaryFail: { backgroundColor: '#3a1a1a' },
  summaryText: { color: '#e6edf3', fontSize: 14, textAlign: 'center' },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#21262d',
  },
  rowPass: {},
  rowFail: { backgroundColor: '#1c0e0e' },
  icon: { fontSize: 14, marginRight: 8 },
  desc: { color: '#c9d1d9', fontSize: 13, flex: 1 },
})
