/**
 * job-store.ts — AI job state tracking via Upstash Redis.
 *
 * Each voice request becomes a job with a 5-minute TTL.
 * The QStash worker reads/writes job state here.
 * The status polling endpoint reads from here.
 *
 * Key schema:
 *   ai:job:{jobId}          → AiJob JSON (TTL 300s)
 *   ai:job:{jobId}:attempts → integer counter (TTL 300s)
 */

import { Redis } from '@upstash/redis'
import { logger } from '@/lib/logger'

const JOB_TTL = 300 // 5 minutes

let _redis: Redis | null = null

function getRedis(): Redis | null {
  if (_redis) return _redis
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  _redis = new Redis({ url, token })
  return _redis
}

const jobKey      = (id: string) => `ai:job:${id}`
const attemptsKey = (id: string) => `ai:job:${id}:attempts`

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface AiJob {
  status:           JobStatus
  userId:           string
  businessId:       string
  timezone:         string
  inputText:        string
  resultText?:      string
  resultAudioUrl?:  string
  actionPerformed?: boolean
  error?:           string
}

export const jobStore = {
  async create(jobId: string, data: Omit<AiJob, 'status'>): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    const job: AiJob = { status: 'queued', ...data }
    await Promise.all([
      redis.set(jobKey(jobId), job, { ex: JOB_TTL }),
      redis.set(attemptsKey(jobId), 0,   { ex: JOB_TTL }),
    ])
  },

  async update(jobId: string, updates: Partial<AiJob>): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    const existing = await this.get(jobId)
    if (!existing) {
      logger.warn('JOB-STORE', `update: job not found ${jobId}`)
      return
    }
    await redis.set(jobKey(jobId), { ...existing, ...updates }, { ex: JOB_TTL })
  },

  async get(jobId: string): Promise<AiJob | null> {
    const redis = getRedis()
    if (!redis) return null
    try {
      return await redis.get<AiJob>(jobKey(jobId))
    } catch {
      return null
    }
  },

  /**
   * Atomically increments the attempt counter.
   * Returns the new count (1-based: first call returns 1).
   */
  async incrementAttempts(jobId: string): Promise<number> {
    const redis = getRedis()
    if (!redis) return 1
    const count = await redis.incr(attemptsKey(jobId))
    await redis.expire(attemptsKey(jobId), JOB_TTL)
    return count as number
  },
}
