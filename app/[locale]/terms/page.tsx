export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Términos y Condiciones de Servicio</h1>
        <p className="text-gray-600 mb-6">Última actualización: 25 de marzo de 2026</p>

        <div className="space-y-8 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-2xl font-semibold mb-4">1. Aceptación de Términos</h2>
            <p>
              Al acceder y utilizar Cronix, aceptas cumplir con estos Términos y Condiciones. Si no estás de acuerdo con alguna parte, no puedes usar la Plataforma. Nos reservamos el derecho de actualizar estos términos en cualquier momento.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">2. Descripción del Servicio</h2>
            <p>
              Cronix es una plataforma SaaS de gestión de citas y servicios que permite a empresas programar, confirmar y recordar citas con clientes mediante notificaciones por WhatsApp. La Plataforma incluye:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Gestión de calendario de citas.</li>
              <li>Notificaciones automáticas por WhatsApp.</li>
              <li>Gestión de clientes y servicios.</li>
              <li>Reportes de negocio y finanzas.</li>
              <li>Autenticación segura con biometría (passkey).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">3. Elegibilidad</h2>
            <p className="mb-3">
              Para usar Cronix debes:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Tener al menos 18 años o ser una entidad legal autorizada.</li>
              <li>Tener autoridad para celebrar contratos vinculantes.</li>
              <li>No estar en una lista de sanciones o restringido por ley.</li>
              <li>Cumplir con leyes de privacidad al procesar datos de clientes.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">4. Creación de Cuenta y Responsabilidad</h2>
            <p className="mb-3">
              Al crear una cuenta, eres responsable de:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Proporcionar información precisa y actualizada.</li>
              <li>Mantener confidencialidad de credenciales de acceso.</li>
              <li>Notificarnos inmediatamente de acceso no autorizado.</li>
              <li>Cumplir con todas las leyes aplicables al usar la Plataforma.</li>
            </ul>
            <p className="mt-3">
              Nos reservamos el derecho de suspender o eliminar cuentas que violen estos términos.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">5. Uso Aceptable</h2>
            <p className="mb-3">
              No puedes usar Cronix para:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Actividades ilegales o que violen derechos de terceros.</li>
              <li>Spam, phishing, malware o ataques cibernéticos.</li>
              <li>Acoso, intimidación o suplantación de identidad.</li>
              <li>Envío de contenido obsceno, difamatorio o discriminatorio.</li>
              <li>Violación de derechos de propiedad intelectual.</li>
              <li>Reverse engineering o acceso no autorizado a sistemas.</li>
              <li>Violación de privacidad de terceros sin consentimiento.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Datos del Cliente</h2>
            <p className="mb-3">
              Eres el controlador de datos de tus clientes. Tú eres responsable de:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Obtener consentimiento válido antes de recopilar datos de clientes.</li>
              <li>Informar a clientes sobre uso de WhatsApp para notificaciones.</li>
              <li>Cumplir con GDPR, CCPA y regulaciones de privacidad locales.</li>
              <li>Mantener confidencialidad de datos sensibles.</li>
              <li>Resolver solicitudes de derechos de privacidad de clientes.</li>
            </ul>
            <p className="mt-3">
              Cronix actúa como procesador de datos bajo tu dirección y no es responsable de cómo uses o manejes datos de clientes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">7. Integraciones de Terceros</h2>
            <p className="mb-3">
              Cronix integra servicios de terceros como:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong>Supabase:</strong> Almacenamiento y autenticación de datos.</li>
              <li><strong>Meta WhatsApp Cloud API:</strong> Envío de mensajes de notificación.</li>
              <li><strong>Stripe/Mercado Pago:</strong> Procesamiento de pagos.</li>
            </ul>
            <p className="mt-3">
              No somos responsables de estos servicios. Consulta sus términos y políticas de privacidad antes de usar Cronix.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">8. Límites de Responsabilidad</h2>
            <p className="mb-3">
              EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Cronix se proporciona &quot;tal cual&quot; sin garantías de ningún tipo.</li>
              <li>No somos responsables por pérdida de datos, interrupción de servicio o daños incidentales.</li>
              <li>Nuestra responsabilidad máxima es igual al monto pagado en el último mes.</li>
              <li>No somos responsables por incumplimiento de notificaciones por fallos en WhatsApp API o Meta.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">9. Propiedad Intelectual</h2>
            <p className="mb-3">
              Cronix es propietaria de toda la tecnología, código, diseños, logos y contenido de la Plataforma. Al usar Cronix, te otorgamos una licencia limitada y no exclusiva para acceder.
            </p>
            <p>
              No puedes copiar, modificar, distribuir o vender ningún contenido de Cronix sin autorización escrita.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">10. Precios y Facturación</h2>
            <p className="mb-3">
              Los precios están disponibles en nuestra página de suscripción. Agreeings:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Los precios están en USD y pueden cambiar con 30 días de notificación.</li>
              <li>La facturación se realiza mensualmente o anualmente según tu plan.</li>
              <li>No ofrecemos reembolsos (excepto si Cronix incumple en servicio crítico).</li>
              <li>Puedes cancelar en cualquier momento y perderás acceso al final del período.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">11. Suspensión y Terminación</h2>
            <p className="mb-3">
              Nos reservamos el derecho de:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Suspender tu cuenta si violas estos términos.</li>
              <li>Terminar servicios con 30 días de notificación por cualquier razón.</li>
              <li>Eliminar datos de tu cuenta después de 90 días de cierre.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">12. Indemnización</h2>
            <p>
              Aceptas indemnizar y defender a Cronix contra cualquier reclamación, daño o costo derivado de tu uso de la Plataforma, violación de estos términos, o incumplimiento de leyes aplicables.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">13. Cumplimiento Legal</h2>
            <p className="mb-3">
              Cronix cumple con:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>GDPR (Reglamento General de Protección de Datos)</li>
              <li>CCPA (Ley de Privacidad del Consumidor de California)</li>
              <li>LGPD (Ley General de Protección de Datos de Brasil)</li>
              <li>Regulaciones de telecomunicaciones aplicables para WhatsApp</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">14. Resolución de Disputas</h2>
            <p className="mb-3">
              Cualquier disputa será resuelta mediante:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Negociación de buena fe en un plazo de 30 días.</li>
              <li>Arbitraje vinculante según reglas de la cámara de comercio.</li>
            </ul>
            <p className="mt-3">
              Ambas partes renuncian al derecho a litigio en corte y juicio por jurado.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">15. Ley Aplicable</h2>
            <p>
              Estos términos se rigen por las leyes del país/estado donde se proporciona el servicio, sin conflictos de disposiciones legales.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">16. Contacto</h2>
            <p className="mb-2">
              Para preguntas sobre estos Términos, contacta:
            </p>
            <p>
              <strong>Email:</strong> tiendaigmimport@gmail.com<br />
              <strong>Plataforma:</strong> https://cronix-app.vercel.app/
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
