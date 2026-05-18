import type {
  ITracer,
  ITraceHandle,
  ITraceSink,
  TraceScope,
  LlmStep,
  ToolStep,
  TraceFinish,
  TraceRecord,
} from './contracts'

/**
 * Stateless factory of trace handles. Single responsibility: vend handles.
 *
 * Each handle is an isolated accumulator for one agent turn. The handle
 * delegates persistence to the injected sink. Neither the tracer nor the
 * handles ever throw — failures are routed to onError.
 */
export class Tracer implements ITracer {
  constructor(
    private readonly sink:    ITraceSink,
    private readonly now:     () => number = () => Date.now(),
    private readonly onError: (stage: string, error: string) => void = () => {},
  ) {}

  start(
    scope:     TraceScope,
    queryHash: string,
    metadata?: Readonly<Record<string, unknown>>,
  ): ITraceHandle {
    return new TraceHandle(this.sink, this.now, this.onError, scope, queryHash, metadata ?? {})
  }
}

class TraceHandle implements ITraceHandle {
  private readonly llmSteps:  LlmStep[]  = []
  private readonly toolCalls: ToolStep[] = []
  private readonly startedAt: number
  private finished = false

  constructor(
    private readonly sink:      ITraceSink,
    private readonly now:       () => number,
    private readonly onError:   (stage: string, error: string) => void,
    private readonly scope:     TraceScope,
    private readonly queryHash: string,
    private readonly metadata:  Readonly<Record<string, unknown>>,
  ) {
    this.startedAt = this.now()
  }

  recordLlmStep(step: LlmStep): void {
    if (this.finished) return
    this.llmSteps.push(step)
  }

  recordToolCall(step: ToolStep): void {
    if (this.finished) return
    this.toolCalls.push(step)
  }

  async finish(input: TraceFinish): Promise<void> {
    if (this.finished) return
    this.finished = true

    const record: TraceRecord = {
      scope:        this.scope,
      queryHash:    this.queryHash,
      outcome:      input.outcome,
      errorCode:    input.errorCode    ?? null,
      finalTextSha: input.finalTextSha ?? null,
      totalTokens:  this.llmSteps.reduce((sum, s) => sum + s.tokens, 0),
      latencyMs:    this.now() - this.startedAt,
      stepsCount:   this.llmSteps.length,
      toolsCount:   this.toolCalls.length,
      llmSteps:     this.llmSteps,
      toolCalls:    this.toolCalls,
      metadata:     this.metadata,
    }

    const res = await this.sink.write(record)
    if (!res.ok) this.onError('finish.write', res.error)
  }
}
