/**
 * networkService.js
 *
 * Lightweight connectivity monitor for React Native.
 * Uses NetInfo for reliable device connectivity detection.
 * Provides subscribe/unsubscribe pattern for online/offline events.
 */

import NetInfo from '@react-native-community/netinfo'

let _isOnline = false
let _listeners = []
let _unsubscribeNetInfo = null

/** Returns current online status (synchronous). */
export function isOnline() {
  return _isOnline
}

/**
 * Subscribe to connectivity changes.
 * Callback receives a boolean: true = online, false = offline.
 * Returns an unsubscribe function.
 */
export function onConnectivityChange(cb) {
  _listeners.push(cb)
  // Fire current state immediately
  cb(_isOnline)
  return () => {
    _listeners = _listeners.filter((l) => l !== cb)
  }
}

/** Start polling for connectivity. Call once at app start. */
export function startNetworkMonitor() {
  if (_unsubscribeNetInfo) return
  _unsubscribeNetInfo = NetInfo.addEventListener(state => {
    _setOnline(state.isConnected && state.isInternetReachable !== false)
  })
  // Initial check
  NetInfo.fetch().then(state => {
    _setOnline(state.isConnected && state.isInternetReachable !== false)
  })
}

/** Stop the monitor. */
export function stopNetworkMonitor() {
  if (_unsubscribeNetInfo) {
    _unsubscribeNetInfo()
    _unsubscribeNetInfo = null
  }
}

async function _check() {
  // No longer needed with NetInfo
}

function _setOnline(val) {
  const changed = _isOnline !== val
  _isOnline = val
  if (changed) {
    for (const cb of _listeners) {
      try {
        cb(val)
      } catch {
        /* swallow listener errors */
      }
    }
  }
}
