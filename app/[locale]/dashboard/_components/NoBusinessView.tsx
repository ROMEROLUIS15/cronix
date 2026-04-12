"use client"

import Image from "next/image"
import Link  from "next/link"
import { ArrowRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { Card }   from "@/components/ui/card"
import { Button } from "@/components/ui/button"

/**
 * NoBusinessView — Empty state shown when the user has no business configured.
 * Pure display component — no props needed (uses its own translations).
 */
export function NoBusinessView() {
  const t = useTranslations('dashboard')

  return (
    <div className="flex items-center justify-center min-h-[80vh] p-4 text-center">
      <div className="w-full max-w-lg mb-12">
        <div className="flex flex-col items-center mb-10 gap-3">
          <div
            className="h-20 w-20 rounded-3xl overflow-hidden flex-shrink-0 animate-slide-up"
            style={{ border: "1px solid rgba(0,98,255,0.25)", boxShadow: "0 0 40px rgba(0,98,255,0.3), 0 0 80px rgba(0,98,255,0.1)" }}
          >
            <Image src="/cronix-logo.jpg" alt="Cronix" width={80} height={80} className="h-full w-full object-cover" sizes="80px" priority />
          </div>
          <div className="relative h-9 w-36 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <Image src="/cronix-letras.jpg" alt="Cronix" fill className="object-contain" sizes="144px" priority />
          </div>
        </div>

        <Card
          className="p-8 sm:p-10 rounded-[2rem] sm:rounded-[2.5rem] animate-slide-up"
          style={{ borderTop: "4px solid #0062FF", background: "rgba(26,26,31,0.95)", animationDelay: "0.2s" }}
        >
          <h2 className="text-2xl sm:text-3xl font-black mb-3 text-center" style={{ color: "#F2F2F2", letterSpacing: "-0.03em" }}>
            {t('welcome.title')}
          </h2>
          <p className="mb-8 text-center text-sm sm:text-base" style={{ color: "#909098" }}>
            {t('welcome.subtitle')}
          </p>
          <Link href="/dashboard/setup">
            <Button className="w-full py-4 sm:py-6 text-base sm:text-lg group btn-primary">
              {t('welcome.button')}
              <ArrowRight size={20} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  )
}
