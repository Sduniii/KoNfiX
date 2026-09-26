import React, { useState, useId } from 'react'
import { DeviceParameter } from '../../types/knx'
import { AlertCircle } from 'lucide-react'

interface ParameterInputFieldProps {
  param: DeviceParameter
  value: string
  disabled?: boolean
  onChange: (val: string) => void
  compact?: boolean
  className?: string
}

export const ParameterInputField: React.FC<ParameterInputFieldProps> = ({
  param,
  value,
  disabled = false,
  onChange,
  compact = false,
  className = '',
}) => {
  const inputId = useId()
  const [isFocused, setIsFocused] = useState(false)

  // Check if parameter is strictly integer or float
  const sfx = (param.suffix || '').trim().toLowerCase()
  const isTimeOrPercentUnit = ['s', 'sek', 'sekunden', 'sec', 'min', 'minuten', 'h', 'std', 'stunden', 'ms', '%'].includes(sfx)

  const isStrictlyInteger =
    param.is_float === false ||
    (isTimeOrPercentUnit && param.is_float !== true) ||
    (param.step !== undefined && param.step !== null && param.step >= 1.0 && param.is_float !== true)

  const min = param.min !== undefined && param.min !== null ? param.min : undefined
  const max = param.max !== undefined && param.max !== null ? param.max : undefined
  const step = param.step !== undefined && param.step !== null ? param.step : (isStrictlyInteger ? 1 : 0.1)

  // Validate current value
  const numVal = parseFloat(value)
  const isNaNVal = value.trim() !== '' && isNaN(numVal)
  const isOutOfMin = min !== undefined && !isNaN(numVal) && numVal < min
  const isOutOfMax = max !== undefined && !isNaN(numVal) && numVal > max
  const hasDecimalWhenInteger = isStrictlyInteger && (value.includes('.') || value.includes(','))
  const isInvalid = isNaNVal || isOutOfMin || isOutOfMax || hasDecimalWhenInteger

  // Keydown filter: prevent decimal separators and scientific notations for integer fields
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return

    // Allow navigation, deletion, clipboard shortcuts
    if (
      ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End', 'Enter'].includes(e.key) ||
      (e.ctrlKey || e.metaKey)
    ) {
      return
    }

    // Up / Down arrow step handling
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const current = isNaN(numVal) ? (min ?? 0) : numVal
      const delta = e.key === 'ArrowUp' ? step : -step
      let next = current + delta

      if (min !== undefined && next < min) next = min
      if (max !== undefined && next > max) next = max

      if (isStrictlyInteger) {
        onChange(Math.round(next).toString())
      } else {
        onChange(Number(next.toFixed(2)).toString())
      }
      return
    }

    if (isStrictlyInteger) {
      // Strictly prevent decimal points, commas, e/E, and negative sign (if min >= 0)
      if (e.key === '.' || e.key === ',' || e.key.toLowerCase() === 'e') {
        e.preventDefault()
        return
      }
      if (e.key === '-' && (min === undefined || min >= 0)) {
        e.preventDefault()
        return
      }
      // Block non-digit characters
      if (!/^[0-9]$/.test(e.key) && e.key !== '-') {
        e.preventDefault()
        return
      }
    } else {
      // Float handling: allow max one decimal dot or comma
      if (e.key === '.' || e.key === ',') {
        if (value.includes('.') || value.includes(',')) {
          e.preventDefault()
        }
        return
      }
      if (e.key === '-' && (min === undefined || min >= 0)) {
        e.preventDefault()
        return
      }
      if (!/^[0-9]$/.test(e.key) && e.key !== '-') {
        e.preventDefault()
        return
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value

    if (isStrictlyInteger) {
      // Sanitize any pasted input: keep only digits and optional leading minus
      raw = raw.replace(/[^0-9-]/g, '')
      if (min !== undefined && min >= 0) {
        raw = raw.replace(/-/g, '')
      }
    } else {
      // Replace comma with dot
      raw = raw.replace(',', '.')
    }

    onChange(raw)
  }

  // Range description helper text
  const rangeInfo = React.useMemo(() => {
    if (min !== undefined && max !== undefined) {
      return `${min} – ${max} ${param.suffix || ''}`.trim()
    } else if (min !== undefined) {
      return `≥ ${min} ${param.suffix || ''}`.trim()
    } else if (max !== undefined) {
      return `≤ ${max} ${param.suffix || ''}`.trim()
    }
    return isStrictlyInteger ? 'Ganzzahl' : undefined
  }, [min, max, param.suffix, isStrictlyInteger])

  return (
    <div className={`relative ${compact ? 'w-full' : 'w-36 shrink-0'} ${className}`}>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          inputMode={isStrictlyInteger ? 'numeric' : 'decimal'}
          pattern={isStrictlyInteger ? '[0-9]*' : undefined}
          value={value}
          disabled={disabled}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          className={`w-full bg-slate-950 border rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none font-mono text-right transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-900/50 ${
            param.suffix ? 'pr-9' : 'pr-2.5'
          } ${
            isInvalid
              ? 'border-rose-500 focus:border-rose-400 bg-rose-950/20 text-rose-200'
              : 'border-slate-800 focus:border-emerald-500'
          }`}
          placeholder={param.default_value}
          title={
            isStrictlyInteger
              ? `Nur ganzzahlige Werte erlaubt${rangeInfo ? ` (${rangeInfo})` : ''}`
              : rangeInfo
              ? `Erlaubter Bereich: ${rangeInfo}`
              : undefined
          }
        />

        {param.suffix && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400 pointer-events-none select-none">
            {param.suffix}
          </span>
        )}
      </div>

      {/* Helper / Error Popover or Badge */}
      {isInvalid && isFocused && (
        <div className="absolute left-0 -bottom-6 z-20 flex items-center gap-1 text-[10px] text-rose-400 font-medium whitespace-nowrap bg-slate-900/95 px-1.5 py-0.5 rounded border border-rose-500/40 shadow-lg">
          <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
          <span>
            {hasDecimalWhenInteger
              ? 'Keine Kommazahlen erlaubt'
              : isOutOfMin
              ? `Min. ${min} ${param.suffix || ''}`
              : isOutOfMax
              ? `Max. ${max} ${param.suffix || ''}`
              : 'Ungültiger Wert'}
          </span>
        </div>
      )}

      {/* Subtle range tooltip on focus when valid */}
      {!isInvalid && isFocused && rangeInfo && (
        <div className="absolute right-0 -bottom-5 z-20 text-[9px] text-slate-400 font-mono bg-slate-900/90 px-1 py-0.2 rounded border border-slate-800 whitespace-nowrap">
          {rangeInfo} {isStrictlyInteger ? '(Ganzzahl)' : ''}
        </div>
      )}
    </div>
  )
}
