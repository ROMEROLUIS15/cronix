/**
 * Router layer contracts. Pure types — runtime-agnostic.
 *
 * Duplicated byte-for-byte under `supabase/functions/_shared/router/contracts.ts`
 * (Deno cannot import from Node paths). A parity test detects drift.
 */

export type IntentName =
  | 'book_appointment'
  | 'cancel_appointment'
  | 'reschedule_appointment'
  | 'check_availability'
  | 'list_appointments'
  | 'pricing_inquiry'
  | 'greeting'
  | 'affirmation'
  | 'negation'

export interface IntentExample {
  readonly text: string
}

export interface IntentDefinition {
  readonly name:        IntentName
  readonly description: string
  readonly examples:    ReadonlyArray<IntentExample>
}

export interface IntentPrototype {
  readonly intent:    IntentName
  readonly text:      string
  readonly embedding: ReadonlyArray<number>
}

export interface ClassifyOptions {
  readonly threshold?: number
}

export interface ClassifyResult {
  readonly intent:     IntentName
  readonly confidence: number
  readonly matched:    string
}

export type Result<T> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: string }

export interface IEmbedder {
  readonly dimensions: number
  embed(text: string): Promise<Result<ReadonlyArray<number>>>
}

export interface ISemanticRouter {
  classify(text: string, opts?: ClassifyOptions): Promise<ClassifyResult | null>
}
