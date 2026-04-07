export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Política de Privacidad</h1>
        <p className="text-gray-600 mb-6">Última actualización: 25 de marzo de 2026</p>

        <div className="space-y-8 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-2xl font-semibold mb-4">1. Introducción</h2>
            <p>
              Cronix (&quot;nosotros&quot;, &quot;nuestro&quot; o &quot;la Plataforma&quot;) se compromete a proteger tu privacidad. Esta Política de Privacidad explica cómo recopilamos, usamos, divulgamos y protegemos tu información cuando utilizas nuestra plataforma de gestión de citas y servicios.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">2. Información que Recopilamos</h2>
            <p className="mb-3">Recopilamos información de varias formas:</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong>Información de Registro:</strong> Nombre, email, número de teléfono, empresa y datos de negocio.</li>
              <li><strong>Información de Citas:</strong> Detalles de clientes, fechas, horarios y servicios contratados.</li>
              <li><strong>Información de Comunicación:</strong> Números de teléfono para notificaciones de WhatsApp.</li>
              <li><strong>Información de Pago:</strong> Datos de transacciones (procesados por proveedores de pago seguros).</li>
              <li><strong>Datos de Uso:</strong> Acciones en la plataforma, páginas visitadas, navegador, IP y datos de dispositivo.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">3. Cómo Usamos tu Información</h2>
            <p className="mb-3">Utilizamos la información recopilada para:</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Proporcionar, mantener y mejorar la Plataforma.</li>
              <li>Enviar recordatorios de citas por WhatsApp y otras notificaciones.</li>
              <li>Procesar pagos y transacciones.</li>
              <li>Comunicarnos contigo sobre cambios, actualizaciones o incidentes de seguridad.</li>
              <li>Cumplir con obligaciones legales y regulatorias.</li>
              <li>Analizar el uso de la Plataforma para mejorar servicios.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">4. Notificaciones por WhatsApp</h2>
            <p className="mb-3">
              Cronix utiliza el servicio WhatsApp Cloud API de Meta para enviar recordatorios de citas y notificaciones. Al usar la Plataforma, autorizas el envío de estos mensajes a tu número de teléfono registrado. Puedes rechazar notificaciones en cualquier momento desde tu perfil.
            </p>
            <p>
              Meta procesa datos como número de teléfono y timestamps de entrega. Consulta la <a href="https://www.whatsapp.com/legal/privacy-policy" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">Política de Privacidad de WhatsApp</a> para más detalles.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">5. Almacenamiento y Seguridad de Datos</h2>
            <p className="mb-3">
              Tu información se almacena en servidores seguros proporcionados por Supabase, que cumple con estándares de seguridad de nivel empresarial. Implementamos:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Cifrado de datos en tránsito (TLS/SSL).</li>
              <li>Cifrado en reposo para datos sensibles.</li>
              <li>Autenticación de dos factores (2FA).</li>
              <li>Control de acceso basado en roles (RBAC).</li>
              <li>Auditoría de acceso a datos sensibles.</li>
            </ul>
            <p className="mt-3">
              Sin embargo, no existe un sistema 100% seguro. Aunque hacemos esfuerzos razonables para proteger tu información, no podemos garantizar seguridad absoluta.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Retención de Datos</h2>
            <p>
              Retenemos tu información mientras tu cuenta esté activa. Si solicitas eliminar tu cuenta, los datos se serán eliminados en un plazo de 30 días, salvo que la ley requiera retenerlos más tiempo (ej: registros de transacciones por motivos fiscales).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">7. Compartición de Información</h2>
            <p className="mb-3">
              Cronix no vende ni alquila tu información personal. Solo compartimos datos cuando es necesario para:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Proveedores de servicios de confianza (hosting, pagos, WhatsApp).</li>
              <li>Cumplimiento de la ley o defensa de derechos legales.</li>
              <li>Otras partes con tu consentimiento explícito.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">8. Tus Derechos de Privacidad</h2>
            <p className="mb-3">Tienes derecho a:</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Acceder a tu información personal.</li>
              <li>Rectificar información inexacta.</li>
              <li>Solicitar la eliminación de datos (derecho al olvido).</li>
              <li>Oponermi al procesamiento de tus datos.</li>
              <li>Solicitar portabilidad de datos.</li>
              <li>Retirar consentimiento en cualquier momento.</li>
            </ul>
            <p className="mt-3">Para ejercer estos derechos, contacta: tiendaigmimport@gmail.com</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">9. Cookies y Tecnologías de Rastreo</h2>
            <p>
              Cronix utiliza cookies para mejorar la experiencia del usuario, mantener sesiones autenticadas y analizar el uso. Puedes desactivar cookies en tu navegador, aunque esto puede afectar la funcionalidad de la Plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">10. Menores de Edad</h2>
            <p>
              Cronix no está dirigida a personas menores de 13 años. No recopilamos información de menores de edad. Si descubrimos que hemos recopilado datos de un menor, eliminaremos esa información inmediatamente.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">11. Cambios en esta Política</h2>
            <p>
              Podemos actualizar esta Política de Privacidad en cualquier momento. Los cambios significativos serán notificados por email. Tu continuidad en el uso de la Plataforma después de cambios constituye aceptación de la nueva política.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">12. Cumplimiento Legal</h2>
            <p className="mb-3">
              Cronix cumple con regulaciones de privacidad incluyendo:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>GDPR (Reglamento General de Protección de Datos)</li>
              <li>CCPA (Ley de Privacidad del Consumidor de California)</li>
              <li>Regulaciones de privacidad locales aplicables</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">13. Contacto</h2>
            <p className="mb-2">
              Si tienes preguntas sobre esta Política de Privacidad o tus datos personales, contacta:
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
