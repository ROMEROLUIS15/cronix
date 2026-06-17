import { getTranslations } from 'next-intl/server'

const CONTACT_EMAIL = 'tiendaigmimport@gmail.com'
const PLATFORM_URL = 'https://cronix-app.vercel.app/'

export default async function PrivacyPage() {
  const t = await getTranslations('privacy')
  const s2Items = t.raw('s2Items') as { label: string; text: string }[]
  const s3Items = t.raw('s3Items') as string[]
  const s5Items = t.raw('s5Items') as string[]
  const s7Items = t.raw('s7Items') as string[]
  const s8Items = t.raw('s8Items') as string[]
  const s12Items = t.raw('s12Items') as string[]

  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">{t('title')}</h1>
        <p className="text-gray-600 mb-6">{t('lastUpdate')}</p>

        <div className="space-y-8 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s1Title')}</h2>
            <p>{t('s1Body')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s2Title')}</h2>
            <p className="mb-3">{t('s2Intro')}</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              {s2Items.map((item) => (
                <li key={item.label}><strong>{item.label}</strong> {item.text}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s3Title')}</h2>
            <p className="mb-3">{t('s3Intro')}</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              {s3Items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s4Title')}</h2>
            <p className="mb-3">{t('s4Body1')}</p>
            <p>
              {t.rich('s4Body2', {
                link: (c) => (
                  <a href="https://www.whatsapp.com/legal/privacy-policy" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">{c}</a>
                ),
              })}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s5Title')}</h2>
            <p className="mb-3">{t('s5Intro')}</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              {s5Items.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="mt-3">{t('s5Outro')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s6Title')}</h2>
            <p>{t('s6Body')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s7Title')}</h2>
            <p className="mb-3">{t('s7Intro')}</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              {s7Items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s8Title')}</h2>
            <p className="mb-3">{t('s8Intro')}</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              {s8Items.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="mt-3">{t('s8Contact')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s9Title')}</h2>
            <p>{t('s9Body')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s10Title')}</h2>
            <p>{t('s10Body')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s11Title')}</h2>
            <p>{t('s11Body')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s12Title')}</h2>
            <p className="mb-3">{t('s12Intro')}</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              {s12Items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">{t('s13Title')}</h2>
            <p className="mb-2">{t('s13Body')}</p>
            <p>
              <strong>{t('s13EmailLabel')}</strong> {CONTACT_EMAIL}<br />
              <strong>{t('s13PlatformLabel')}</strong> {PLATFORM_URL}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
