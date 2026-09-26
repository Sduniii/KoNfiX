import { useEffect, useState, useRef, useCallback } from 'react'
import { KnxTelegram } from '../types/knx'

export function useBusMonitor() {
  const [telegrams, setTelegrams] = useState<KnxTelegram[]>([])
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/bus`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
      }

      ws.onmessage = (event) => {
        if (isPaused) return
        try {
          const raw = JSON.parse(event.data)
          if (!raw) return

          // If message is a diagnostics event, dispatch it as a window event and DO NOT push to telegrams
          if (raw.event || !raw.destination) {
            if (raw.event) {
              window.dispatchEvent(new CustomEvent('knx-diagnostics-event', { detail: raw }))
            }
            return
          }

          const telegram: KnxTelegram = raw
          setTelegrams((prev) => {
            // Keep up to 250 latest telegrams in memory
            const updated = [telegram, ...prev]
            if (updated.length > 250) {
              return updated.slice(0, 250)
            }
            return updated
          })
        } catch (err) {
          console.error('Failed to parse telegram:', err)
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        // Auto reconnect after 2 seconds
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect()
        }, 2000)
      }

      ws.onerror = (err) => {
        console.warn('WebSocket connection warning:', err)
        ws.close()
      }
    } catch (e) {
      console.error('WebSocket connection error:', e)
    }
  }, [isPaused])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  const clearTelegrams = () => setTelegrams([])
  const togglePause = () => setIsPaused((prev) => !prev)

  return {
    telegrams,
    isConnected,
    isPaused,
    clearTelegrams,
    togglePause,
  }
}
