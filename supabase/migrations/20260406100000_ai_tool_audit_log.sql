-- Migration: Tool Audit Log
-- 
-- Tabla append-only para rastrear cada ejecución de tool del asistente de IA.
-- Propósito: debugging de producción, detección de abuso, y observabilidad.
--
-- Diseño:
--   - NO almacena argumentos directos (pueden contener PII como nombres/teléfonos)
--   - Solo almacena el nombre del tool, duración, estado, y metadata de negocio
--   - RLS: los owners solo pueden ver logs de su propio business_id
--   - Partitioning futuro: si crece mucho, añadir index parcial por created_at

CREATE TABLE IF NOT EXISTS ai_tool_audit_log (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id     uuid        NOT NULL,
  tool_name       text        NOT NULL,
  duration_ms     integer,
  result_status   text        NOT NULL CHECK (result_status IN ('success', 'error', 'timeout', 'rate_limited')),
  -- Fingerprint hash para correlacionar sin exponer PII.
  -- SHA256 truncado de los argumentos de la tool.
  args_fingerprint text
);
-- Índices para queries de análisis frecuentes
CREATE INDEX IF NOT EXISTS idx_audit_log_business_time 
  ON ai_tool_audit_log (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_tool 
  ON ai_tool_audit_log (user_id, tool_name);
-- RLS: Habilitado. Los owners leen solo sus propios logs.
ALTER TABLE ai_tool_audit_log ENABLE ROW LEVEL SECURITY;
-- Policy: SELECT solo para el owner del business_id
CREATE POLICY "business_owner_read_audit_log"
  ON ai_tool_audit_log
  FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM users WHERE id = auth.uid()
    )
  );
-- INSERT bloqueado para el anon role — solo el service_role (server-side) puede insertar.
-- Esto previene que usuarios falsifiquen entradas de auditoría.
CREATE POLICY "service_role_insert_audit_log"
  ON ai_tool_audit_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);
-- Comentarios para documentación en Supabase Studio
COMMENT ON TABLE  ai_tool_audit_log IS 'Append-only log of AI tool executions. Used for debugging, abuse detection, and observability. No PII stored directly.';
COMMENT ON COLUMN ai_tool_audit_log.args_fingerprint IS 'Truncated SHA256 of tool arguments for correlation without exposing PII.';
COMMENT ON COLUMN ai_tool_audit_log.result_status IS 'success | error | timeout | rate_limited';
