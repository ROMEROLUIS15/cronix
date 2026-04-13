"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Store,
  Clock,
  Bell,
  Save,
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  MessageCircle,
  Link as LinkIcon,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Palette,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Business, BusinessSettingsJson } from "@/types";
import { PhoneInputFlags, Country } from "@/components/ui/phone-input-flags";
import { BUSINESS_CATEGORIES } from "@/lib/constants/business";
import { useTranslations } from "next-intl";
import { useSettingsForm, type DayHours } from "./hooks/use-settings-form";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const {
    biz,
    loading,
    saving,
    savingHours,
    savingFab,
    savingNotif,
    generatingSlug,
    form,
    setForm,
    selectedCountry,
    setSelectedCountry,
    hours,
    setHours,
    notifSettings,
    setNotifSettings,
    showLuisFab,
    copiedLink,
    msg,
    whatsappLink,
    updateHour,
    handleSaveBiz,
    handleSaveHours,
    handleSaveNotifications,
    handleSaveLuisFab,
    handleGenerateSlug,
    copyHoursToAll,
    getHour,
    DAYS,
    notif,
    brandColor,
    setBrandColor,
    logoUrl,
    uploadingLogo,
    savingBrand,
    logoFileInputRef,
    handleSaveBrandColor,
    handleLogoChange,
  } = useSettingsForm();

  const [localCopiedLink, setLocalCopiedLink] = useState(false);

  const WA_NUMBER = '584147531158';

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "#F2F2F2" }}>
          {t('title')}
        </h1>
        <p className="text-sm" style={{ color: "#909098" }}>
          {t('subtitle')}
        </p>
      </div>

      {msg && (
        <div
          className={`p-4 rounded-xl flex items-center gap-3 text-sm border`}
          style={
            msg.type === "success"
              ? {
                  background: "rgba(48,209,88,0.08)",
                  border: "1px solid rgba(48,209,88,0.2)",
                  color: "#30D158",
                }
              : {
                  background: "rgba(255,59,48,0.08)",
                  border: "1px solid rgba(255,59,48,0.2)",
                  color: "#FF3B30",
                }
          }
        >
          {msg.type === "success" ? (
            <CheckCircle2 size={18} />
          ) : (
            <AlertCircle size={18} />
          )}
          {msg.text}
        </div>
      )}

      {/* Business Profile */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,98,255,0.1)" }}
          >
            <Store size={18} style={{ color: "#0062FF" }} />
          </div>
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              {t('bizProfile')}
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              {t('bizProfileSub')}
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: "#F2F2F2" }}
            >
              {t('bizName')}
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-base"
              placeholder={t('bizNamePlace')}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: "#F2F2F2" }}
              >
                {t('category')}
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="input-base"
                style={{ backgroundColor: "#212125" }}
              >
                <option value="">{t('categoryPlace')}</option>
                {BUSINESS_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: "#F2F2F2" }}
              >
                {t('phone')}
              </label>
              <PhoneInputFlags
                country={selectedCountry}
                onCountryChange={(c) => setSelectedCountry(c as Country)}
                localPhone={form.phoneLocal}
                onLocalPhoneChange={(v) => setForm({ ...form, phoneLocal: v })}
              />
            </div>
          </div>
          <div>
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: "#F2F2F2" }}
            >
              {t('address')}
            </label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="input-base"
              placeholder={t('addressPlace')}
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleSaveBiz}
              loading={saving}
              leftIcon={<Save size={16} />}
            >
              {t('saveChanges')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Branding */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,98,255,0.1)" }}
          >
            <Palette size={18} style={{ color: "#0062FF" }} />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "#F2F2F2" }}>
              {t('brandingTitle')}
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              {t('brandingSub')}
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Logo upload */}
          <div>
            <label className="block text-sm font-medium mb-3" style={{ color: "#F2F2F2" }}>
              {t('brandingLogo')}
            </label>
            <div className="flex items-center gap-4">
              <div
                className="h-16 w-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
                style={{ background: "#212125", border: "1px solid #272729" }}
              >
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt={t('brandingLogoAlt')}
                    width={64}
                    height={64}
                    className="h-full w-full object-cover"
                    sizes="64px"
                  />
                ) : (
                  <span className="text-xs" style={{ color: "#909098" }}>
                    {t('brandingNoLogo')}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  onChange={handleLogoChange}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={uploadingLogo}
                  onClick={() => logoFileInputRef.current?.click()}
                >
                  {uploadingLogo
                    ? <Loader2 size={14} className="animate-spin" />
                    : t('brandingUploadLogo')}
                </Button>
                <p className="text-xs" style={{ color: "#909098" }}>
                  {t('brandingLogoHint')}
                </p>
              </div>
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-sm font-medium mb-3" style={{ color: "#F2F2F2" }}>
              {t('brandingColor')}
            </label>
            <div className="flex items-center gap-4">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-10 w-16 rounded-lg cursor-pointer border-0 bg-transparent p-0"
                aria-label={t('brandingColor')}
              />
              <span className="text-sm font-mono" style={{ color: "#909098" }}>
                {brandColor.toUpperCase()}
              </span>
              <div
                className="h-8 w-8 rounded-lg flex-shrink-0"
                style={{ backgroundColor: brandColor, border: "1px solid #272729" }}
              />
            </div>
            <p className="text-xs mt-2" style={{ color: "#909098" }}>
              {t('brandingColorHint')}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => handleSaveBrandColor(brandColor)}
              loading={savingBrand}
              leftIcon={<Save size={16} />}
            >
              {t('saveChanges')}
            </Button>
          </div>
        </div>
      </Card>

      {/* WhatsApp Deep Link */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(37,211,102,0.1)" }}
          >
            <MessageCircle size={18} style={{ color: "#25D366" }} />
          </div>
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              {t('waLinkTitle')}
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              {t('waLinkSub')}
            </p>
          </div>
        </div>

        {whatsappLink ? (
          <>
            <div
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: "#16161C", border: "1px solid #2E2E33" }}
            >
              <LinkIcon size={16} className="flex-shrink-0" style={{ color: "#909098" }} />
              <span
                className="text-sm truncate flex-1 font-mono"
                style={{ color: "#F2F2F2" }}
              >
                {whatsappLink}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="flex-shrink-0 gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText(whatsappLink);
                  setLocalCopiedLink(true);
                  setTimeout(() => setLocalCopiedLink(false), 2000);
                }}
              >
                {localCopiedLink ? (
                  <>
                    <CheckCircle2 size={14} style={{ color: "#30D158" }} />
                    <span style={{ color: "#30D158" }}>{t('copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    {t('copy')}
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs mt-3" style={{ color: "#909098" }}>
              {t('waDescGenerated')}
            </p>
          </>
        ) : (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm" style={{ color: "#909098" }}>
              {t('waDescNoGenerated')}
            </p>
            <Button
              onClick={handleGenerateSlug}
              loading={generatingSlug}
              leftIcon={<MessageCircle size={16} />}
            >
              {t('generateWaLink')}
            </Button>
          </div>
        )}
      </Card>

      {/* Working Hours */}
      <Card>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,98,255,0.1)" }}
            >
              <Clock size={18} style={{ color: "#0062FF" }} />
            </div>
            <div>
              <h2
                className="text-base font-semibold"
                style={{ color: "#F2F2F2" }}
              >
                {t('hoursTitle')}
              </h2>
              <p className="text-xs" style={{ color: "#909098" }}>
                {t('hoursSub')}
              </p>
            </div>
          </div>

          {Object.values(hours).some(h => h.active) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const firstActive = DAYS.find(d => hours[d]?.active);
                if (firstActive) copyHoursToAll(firstActive);
              }}
              className="text-xs h-8 gap-1.5"
            >
              <Copy size={13} />
              {t('copyToAll')}
            </Button>
          )}
        </div>

        <div className="space-y-3">
          {DAYS.map((key) => {
            const h: DayHours = getHour(key);
            return (
              <div
                key={key}
                className={`rounded-2xl p-4 transition-all duration-200 ${h.active ? 'bg-brand-500/5 border-brand-500/20' : 'bg-[#1C1C21] border-[#2E2E33]'}`}
                style={{ border: "1px solid" }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Day and Status Toggle */}
                  <div className="flex items-center justify-between sm:justify-start gap-4">
                    <div className="w-24">
                      <span
                        className={`text-sm font-bold ${h.active ? 'text-white' : 'text-[#8A8A90]'}`}
                      >
                        {t(`days.${key}`)}
                      </span>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={h.active}
                          onChange={(e) =>
                            updateHour(key, "active", e.target.checked)
                          }
                          className="sr-only peer"
                        />
                        <div
                          className="w-10 h-5 rounded-full transition-colors bg-[#3A3A3F] peer-checked:bg-blue-600"
                        />
                        <div
                          className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5"
                        />
                      </div>
                      <span className={`text-[11px] font-bold uppercase tracking-wider transition-colors ${h.active ? 'text-brand-400' : 'text-[#606068]'}`}>
                        {h.active ? t('open') : t('close')}
                      </span>
                    </label>
                  </div>

                  {/* Time Selectors */}
                  {h.active && (
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 animate-fade-in flex-1 sm:max-w-[340px] w-full items-end">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-[#6A6A72] uppercase tracking-widest mb-1.5 ml-1">{t('from')}</p>
                        <input
                          type="time"
                          value={h.open}
                          onChange={(e) => updateHour(key, "open", e.target.value)}
                          className="w-full bg-[#16161C] border border-[#2E2E33] rounded-xl px-3 py-2.5 text-sm text-white font-medium focus:border-brand-500 outline-none transition-all"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-[#6A6A72] uppercase tracking-widest mb-1.5 ml-1">{t('to')}</p>
                        <input
                          type="time"
                          value={h.close}
                          onChange={(e) => updateHour(key, "close", e.target.value)}
                          className="w-full bg-[#16161C] border border-[#2E2E33] rounded-xl px-3 py-2.5 text-sm text-white font-medium focus:border-brand-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSaveHours}
              loading={savingHours}
              leftIcon={<Save size={16} />}
              className="w-full sm:w-auto"
            >
              {t('saveHoursBtn')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Admin Alerts */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(34,197,94,0.1)" }}
          >
            <ShieldCheck size={18} style={{ color: "#22C55E" }} />
          </div>
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              {t('adminNotifTitle')}
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              {t('adminNotifSub')}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div
            className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl gap-4"
            style={{ background: "#212125", border: "1px solid #2E2E33" }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: "#F2F2F2" }}>
                {t('waBiz')}
              </p>
              <p className="text-xs mt-1" style={{ color: "#909098" }}>
                {t('waBizSub')}
              </p>
            </div>

            {(() => {
              const settings = (biz?.settings as unknown as BusinessSettingsJson) || {};
              const isVerified = settings.wa_verified === true;

              if (isVerified && biz?.phone) {
                return (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/20 self-start sm:self-center">
                    <CheckCircle2 size={16} className="text-[#22C55E]" />
                    <span className="text-sm font-medium text-[#22C55E]">
                      {t('verified')}{biz.phone}
                    </span>
                  </div>
                );
              }

              return (
                <a
                  href={`https://wa.me/${WA_NUMBER}?text=VINCULAR-${biz?.slug || ''}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#22C55E] hover:bg-[#16a34a] transition-colors self-start sm:self-center whitespace-nowrap"
                >
                  <Smartphone size={16} className="text-white" />
                  <span className="text-sm font-semibold text-white">
                    {t('linkWa')}
                  </span>
                </a>
              );
            })()}
          </div>
        </div>
      </Card>

      {/* Smart Assistant */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(168,85,247,0.1)" }}
          >
            <Sparkles size={18} style={{ color: "#A855F7" }} />
          </div>
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              {t('aiAssistantTitle')}
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              {t('aiAssistantSub')}
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <div
            className="flex items-center justify-between p-4 rounded-xl"
            style={{ background: "#212125", border: "1px solid #2E2E33" }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: "#F2F2F2" }}>
                {t('fabTitle')}
              </p>
              <p className="text-xs" style={{ color: "#909098" }}>
                {t('fabSub')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {savingFab && <Loader2 size={16} className="animate-spin text-[#909098]" />}
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={showLuisFab}
                  onChange={(e) => handleSaveLuisFab(e.target.checked)}
                  disabled={savingFab}
                  className="sr-only peer"
                />
                <div
                  className="w-10 h-5 rounded-full transition-colors"
                  style={{ background: showLuisFab ? "#A855F7" : "#3A3A3F" }}
                />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
              </label>
            </div>
          </div>
        </div>
      </Card>

      {/* Notifications */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,98,255,0.1)" }}
          >
            <Bell size={18} style={{ color: "#0062FF" }} />
          </div>
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              {t('remindersTitle')}
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              {t('remindersSub')}
            </p>
          </div>
        </div>
        <div className="space-y-4">
          {(
            [
              { key: "whatsapp" as const, label: t('waChannel'), desc: t('waChannelSub') },
            ] as const
          ).map(({ key, label, desc }) => (
            <div
              key={key}
              className="flex items-center justify-between p-4 rounded-xl"
              style={{ background: "#212125", border: "1px solid #2E2E33" }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: "#F2F2F2" }}>
                  {label}
                </p>
                <p className="text-xs" style={{ color: "#909098" }}>
                  {desc}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifSettings[key]}
                  onChange={e =>
                    setNotifSettings(prev => ({ ...prev, [key]: e.target.checked }))
                  }
                  className="sr-only peer"
                />
                <div
                  className="w-10 h-5 rounded-full transition-colors"
                  style={{ background: notifSettings[key] ? "#0062FF" : "#3A3A3F" }}
                />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
              </label>
            </div>
          ))}
          {/* PWA Push Notifications */}
          {notif.state !== 'unsupported' && (
            <div
              className="flex items-center justify-between p-4 rounded-xl"
              style={{ background: "#212125", border: "1px solid #2E2E33" }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: "#F2F2F2" }}>
                  {t('pushNotif.title')}
                </p>
                <p className="text-xs" style={{ color: "#909098" }}>
                  {notif.state === 'denied'
                    ? t('pushNotif.denied')
                    : notif.state === 'missing_config'
                    ? t('pushNotif.missingConfig')
                    : notif.state === 'sw_unavailable'
                    ? t('pushNotif.unavailable')
                    : notif.loading
                    ? t('pushNotif.loading')
                    : notif.subscribed
                    ? t('pushNotif.active')
                    : t('pushNotif.receiveAlerts')}
                </p>
              </div>
              {notif.loading ? (
                <Loader2 size={20} className="animate-spin flex-shrink-0" style={{ color: '#0062FF' }} />
              ) : (
                <button
                  type="button"
                  onClick={() => notif.subscribed ? notif.unsubscribe() : notif.subscribe()}
                  disabled={
                    notif.state === 'denied' ||
                    notif.state === 'missing_config' ||
                    notif.state === 'sw_unavailable'
                  }
                  className="relative flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={notif.subscribed ? t('pushNotif.btnDisable') : t('pushNotif.btnEnable')}
                >
                  <div
                    className="w-10 h-5 rounded-full transition-colors"
                    style={{ background: notif.subscribed ? '#0062FF' : '#3A3A3F' }}
                  />
                  <div
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200"
                    style={{ left: notif.subscribed ? '22px' : '2px' }}
                  />
                </button>
              )}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveNotifications}
              loading={savingNotif}
              leftIcon={<Save size={16} />}
              className="w-full sm:w-auto"
            >
              {t('saveReminders')}
            </Button>
          </div>
        </div>
      </Card>

      <Card style={{ border: "1px solid rgba(0,98,255,0.2)" }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#F2F2F2" }}>
              {t('plan.current', { plan: biz?.plan ?? "free" })}
            </p>
            <p className="text-xs" style={{ color: "#909098" }}>
              {t('plan.fullAccess')}
            </p>
          </div>
          <Button variant="secondary" className="w-full sm:w-auto flex-shrink-0">
            {t('plan.managePlan')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
