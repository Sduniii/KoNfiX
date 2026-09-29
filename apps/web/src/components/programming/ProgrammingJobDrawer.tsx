import React, { useState, useEffect } from 'react'
import {
  Zap,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronUp,
  ChevronDown,
  X,
  Play,
  Terminal,
  Layers,
  Cpu,
  ShieldCheck,
  Ban,
  Trash2,
} from 'lucide-react'
import { ProgrammingJob, ProgrammingJobStatus } from '../../types/programming'
import { fetchProgrammingJobs, cancelProgrammingJob, createProgrammingJob } from '../../services/api'

export const getJobStatusStr = (status: any): string => {
  if (typeof status === 'string') return status
  if (status && typeof status === 'object') {
    return Object.keys(status)[0] || 'Unknown'
  }
  return 'Unknown'
}

interface ProgrammingJobDrawerProps {
  onJobsUpdated?: () => void
}

export const ProgrammingJobDrawer: React.FC<ProgrammingJobDrawerProps> = ({
  onJobsUpdated,
}) => {
  const [jobs, setJobs] = useState<ProgrammingJob[]>([])
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [showHexDiff, setShowHexDiff] = useState<boolean>(false)

  // Poll active jobs every 1.5s
  useEffect(() => {
    let isMounted = true
    const poll = async () => {
      try {
        const list = await fetchProgrammingJobs()
        if (isMounted) {
          setJobs(list)
          // If there's an active running job and no selection, select it
          const running = list.find((j) => {
            const s = getJobStatusStr(j.status)
            return s !== 'Success' && s !== 'Failed' && s !== 'Cancelled'
          })
          if (running && !selectedJobId) {
            setSelectedJobId(running.id)
          }
        }
      } catch (err) {
        // silently ignore polling errors
      }
    }

    poll()
    const timer = setInterval(poll, 1500)
    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [selectedJobId])

  const activeJob = jobs.find((j) => {
    const s = getJobStatusStr(j.status)
    return s !== 'Success' && s !== 'Failed' && s !== 'Cancelled'
  })

  const selectedJob = jobs.find((j) => j.id === selectedJobId) || jobs[0] || null

  const handleCancel = async (jobId: string) => {
    try {
      await cancelProgrammingJob(jobId)
      const list = await fetchProgrammingJobs()
      setJobs(list)
      if (onJobsUpdated) onJobsUpdated()
    } catch (err: any) {
      alert(err.message || 'Fehler beim Abbrechen des Jobs')
    }
  }

  const handleRetry = async (job: ProgrammingJob) => {
    try {
      const newJob = await createProgrammingJob(job.device_id, job.job_type)
      const list = await fetchProgrammingJobs()
      setJobs(list)
      setSelectedJobId(newJob.id)
      if (onJobsUpdated) onJobsUpdated()
    } catch (err: any) {
      alert(err.message || 'Fehler beim Neustarten des Jobs')
    }
  }

  // Don't render anything if there are zero jobs and drawer is closed
  if (jobs.length === 0 && !isOpen) {
    return null
  }

  const handleFlashNow = async (deviceId: string) => {
    try {
      const newJob = await createProgrammingJob(deviceId, 'Partial')
      const list = await fetchProgrammingJobs()
      setJobs(list)
      setSelectedJobId(newJob.id)
      if (onJobsUpdated) onJobsUpdated()
    } catch (err: any) {
      alert(err.message || 'Fehler beim Starten des Flash-Vorgangs')
    }
  }

  const renderStatusBadge = (status: any, jobType?: string) => {
    const s = getJobStatusStr(status)
    if (s === 'Verifying') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded animate-pulse">
          <ShieldCheck className="w-3 h-3" /> Prüflauf...
        </span>
      )
    }
    if (s === 'Success' && jobType === 'Verify') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded">
          <ShieldCheck className="w-3 h-3" /> Geprüft
        </span>
      )
    }
    switch (s) {
      case 'Success':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3" /> Erfolgreich
          </span>
        )
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded">
            <AlertCircle className="w-3 h-3" /> Fehler
          </span>
        )
      case 'Cancelled':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">
            <Ban className="w-3 h-3" /> Abgebrochen
          </span>
        )
      case 'Queued':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
            <Clock className="w-3 h-3" /> Wartend
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded animate-pulse">
            <Zap className="w-3 h-3" /> Schreibt...
          </span>
        )
    }
  }

  return (
    <div className="fixed bottom-3 right-4 z-40 flex flex-col items-end pointer-events-none select-none">
      {/* Expanded Drawer */}
      {isOpen && (
        <div className="pointer-events-auto w-[560px] max-h-[460px] bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden mb-2 animate-in slide-in-from-bottom-3 duration-200">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-slate-100">
                KNX Flash-Manager & Job-Queue
              </span>
              <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-1.5 py-0.2 rounded">
                {jobs.length} Jobs
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body: Split View (Job List on Left, Detail & Logs on Right) */}
          <div className="flex-1 flex overflow-hidden min-h-[300px]">
            {/* Job List */}
            <div className="w-48 border-r border-slate-800 overflow-y-auto divide-y divide-slate-800/60 bg-slate-950/30">
              {jobs.map((job) => {
                const isSelected = selectedJob?.id === job.id
                return (
                  <div
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className={`p-2.5 text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-amber-500/15 border-l-2 border-amber-400 text-slate-100 font-medium'
                        : 'hover:bg-slate-800/40 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-amber-400 text-[11px]">
                        {job.device_address}
                      </span>
                      {renderStatusBadge(job.status, job.job_type)}
                    </div>
                    <div className="truncate text-[11px] text-slate-200 mt-0.5">
                      {job.device_name}
                    </div>
                    {getJobStatusStr(job.status) !== 'Success' &&
                      getJobStatusStr(job.status) !== 'Failed' &&
                      getJobStatusStr(job.status) !== 'Cancelled' && (
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${job.progress_percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              {jobs.length === 0 && (
                <div className="p-4 text-center text-slate-500 text-xs italic">
                  Keine Programmier-Aufträge vorhanden.
                </div>
              )}
            </div>

            {/* Job Details & Terminal Logs */}
            {selectedJob ? (
              <div className="flex-1 flex flex-col p-4 overflow-hidden bg-slate-900/50">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-amber-400 text-sm">
                        {selectedJob.device_address}
                      </span>
                      <span className="font-semibold text-slate-200 text-xs">
                        {selectedJob.device_name}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                      <span>Typ: {selectedJob.job_type}</span>
                      <span>•</span>
                      <span>Fortschritt: {selectedJob.progress_percent}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {renderStatusBadge(selectedJob.status, selectedJob.job_type)}
                    {getJobStatusStr(selectedJob.status) === 'Failed' && (
                      <button
                        onClick={() => handleRetry(selectedJob)}
                        className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 flex items-center gap-1 transition-colors"
                        title="Job erneut starten"
                      >
                        <RotateCcw className="w-3 h-3" /> Erneut versuchen
                      </button>
                    )}
                    {getJobStatusStr(selectedJob.status) === 'Queued' && (
                      <button
                        onClick={() => handleCancel(selectedJob.id)}
                        className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 transition-colors"
                        title="Job abbrechen"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="py-2.5">
                  <div className="flex justify-between text-[11px] text-slate-300 font-medium mb-1">
                    <span className="truncate">{selectedJob.current_step}</span>
                    <span className="font-mono">{selectedJob.progress_percent}%</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        getJobStatusStr(selectedJob.status) === 'Failed'
                          ? 'bg-rose-500'
                          : getJobStatusStr(selectedJob.status) === 'Success'
                          ? 'bg-emerald-500'
                          : 'bg-amber-500'
                      }`}
                      style={{ width: `${selectedJob.progress_percent}%` }}
                    />
                  </div>
                </div>

                {/* Visual action alert when waiting for programming button */}
                {selectedJob.current_step.includes('Bitte Programmiertaste') && (
                  <div className="mb-2 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2.5 text-xs text-amber-300 animate-pulse">
                    <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-bold">Programmiertaste am Gerät drücken!</div>
                      <div className="text-[10px] text-amber-400/80">Die rote Programmier-LED am KNX-Gerät muss aufleuchten.</div>
                    </div>
                  </div>
                )}

                {/* Verification Report Card */}
                {selectedJob.verification_report && (
                  <div className="mb-2 p-3 bg-slate-950/90 border border-slate-800 rounded-xl space-y-2.5 shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {selectedJob.verification_report.is_identical ? (
                          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-xs">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>100% Identisch (Gerät ist synchron)</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-cyan-400 font-semibold text-xs">
                            <ShieldCheck className="w-4 h-4" />
                            <span>
                              {selectedJob.verification_report.diff_bytes_count} Bytes Abweichung
                              ({selectedJob.verification_report.diff_chunks.length} Blöcke)
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                          {selectedJob.verification_report.mask_version}
                        </span>
                        {!selectedJob.verification_report.is_identical && (
                          <button
                            type="button"
                            onClick={() => handleFlashNow(selectedJob.device_id)}
                            className="py-1 px-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-sm shadow-amber-600/20 transition-colors"
                          >
                            <Zap className="w-3 h-3 text-amber-200" />
                            <span>Jetzt übertragen</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-300">
                      {selectedJob.verification_report.summary_message}
                    </div>

                    {/* Parameter diff summary */}
                    {selectedJob.verification_report.parameter_diffs && selectedJob.verification_report.parameter_diffs.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                          Geänderte Parameter ({selectedJob.verification_report.parameter_diffs.length})
                        </div>
                        <div className="max-h-20 overflow-y-auto space-y-1 text-[11px]">
                          {selectedJob.verification_report.parameter_diffs.map((diff, i) => (
                            <div key={i} className="flex items-center justify-between bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                              <span className="text-slate-300 truncate max-w-[200px]" title={diff.param_name}>
                                {diff.param_name}
                              </span>
                              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                                <span className="text-slate-500 line-through">{diff.old_value}</span>
                                <span className="text-slate-400">→</span>
                                <span className="text-emerald-400 font-bold">{diff.new_value}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Memory Diff Accordion */}
                    {selectedJob.verification_report.diff_chunks.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-slate-800/80">
                        <button
                          type="button"
                          onClick={() => setShowHexDiff(!showHexDiff)}
                          className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                        >
                          <span>{showHexDiff ? '▼ Hex-Speicherabgleich ausblenden' : '▶ Hex-Speicherabgleich anzeigen'}</span>
                        </button>
                        {showHexDiff && (
                          <div className="max-h-24 overflow-y-auto font-mono text-[10px] bg-slate-900 p-2 rounded border border-slate-800 space-y-1">
                            {selectedJob.verification_report.diff_chunks.map((chk, i) => (
                              <div key={i} className="flex items-center justify-between border-b border-slate-800/60 pb-0.5">
                                <span className="text-amber-400 font-bold">
                                  0x{chk.address.toString(16).toUpperCase().padStart(4, '0')} [{chk.segment_name}]:
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-rose-400/90 font-mono" title="Aktor (Ist)">{chk.device_bytes_hex}</span>
                                  <span className="text-slate-500">vs</span>
                                  <span className="text-emerald-400 font-bold font-mono" title="Projekt (Soll)">{chk.target_bytes_hex}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Log Terminal Box */}
                <div className="flex-1 flex flex-col rounded-lg bg-slate-950 border border-slate-800 overflow-hidden mt-1">
                  <div className="px-2.5 py-1 bg-slate-900 border-b border-slate-800 flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                    <Terminal className="w-3 h-3 text-sky-400" />
                    <span>Live-Protokoll</span>
                  </div>
                  <div className="flex-1 p-2 overflow-y-auto font-mono text-[11px] space-y-1 text-slate-300">
                    {selectedJob.log_messages.map((msg, i) => (
                      <div key={i} className="leading-tight">
                        <span className="text-slate-500">&gt;</span> {msg}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
                Wähle einen Job links aus.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsed Floating Status Bar */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="pointer-events-auto cursor-pointer flex items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-900/95 hover:bg-slate-900 border border-slate-800 shadow-xl text-xs font-semibold text-slate-100 transition-all hover:border-amber-500/50 group"
      >
        <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold">
          <Zap className={`w-4 h-4 ${activeJob ? 'animate-bounce' : ''}`} />
        </div>

        <div>
          {activeJob ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-amber-400">{activeJob.device_address}</span>
                <span className="text-slate-200 font-bold truncate max-w-[180px]">
                  {activeJob.device_name}
                </span>
                <span className="font-mono text-[11px] text-sky-400">
                  [{activeJob.progress_percent}%]
                </span>
              </div>
              <div className="text-[10px] text-slate-400 truncate max-w-[240px]">
                {activeJob.current_step}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-slate-200 font-semibold">Flash-Manager</div>
              <div className="text-[10px] text-slate-400">{jobs.length} Jobs protokolliert</div>
            </div>
          )}
        </div>

        <div className="p-1 text-slate-500 group-hover:text-slate-200 transition-colors">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </div>
      </div>
    </div>
  )
}
