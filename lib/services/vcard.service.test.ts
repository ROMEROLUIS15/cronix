import { describe, it, expect } from 'vitest'
import { parseVCards } from './vcard.service'

/**
 * `parseVCards` es la ÚNICA ruta que llega a la agenda del iPhone desde la web
 * (WebKit no implementa la Contact Picker API y el AutoFill de Safari rellena
 * la ficha propia, no la de un tercero). Ver modulo-dashboard §9.
 *
 * Si este parser falla, el usuario de iOS se queda sin ninguna ruta. Los casos
 * de abajo usan formas REALES de export, no vCards inventadas:
 *  - iOS Contactos exporta 3.0 con prefijos de grupo `item1.`
 *  - Android/Outlook exportan 2.1 con quoted-printable para los acentos
 *  - vCard 4.0 escribe los valores como URI (`tel:`, `mailto:`)
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Export literal de Contactos de iOS 17 (una ficha). */
const IOS_SINGLE = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'PRODID:-//Apple Inc.//iPhone OS 17.5//EN',
  'N:Pérez;Juan;;;',
  'FN:Juan Pérez',
  'TEL;type=CELL;type=VOICE;type=pref:+58 412-1234567',
  'EMAIL;type=INTERNET;type=HOME;type=pref:juan@ejemplo.com',
  'END:VCARD',
].join('\r\n')

/** Dos fichas compartidas de golpe desde Contactos. */
const IOS_MULTI = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Ana Gómez',
  'TEL;type=CELL:+57 300 1234567',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Luis Romero',
  'TEL;type=CELL:+58 424 9876543',
  'END:VCARD',
].join('\r\n')

// ── Casos ───────────────────────────────────────────────────────────────────

describe('parseVCards', () => {
  describe('export real de iOS', () => {
    it('extrae nombre, móvil y email de una ficha 3.0', () => {
      expect(parseVCards(IOS_SINGLE)).toEqual([
        { name: 'Juan Pérez', phone: '+58 412-1234567', email: 'juan@ejemplo.com' },
      ])
    })

    it('devuelve una entrada por ficha cuando se comparten varias', () => {
      const result = parseVCards(IOS_MULTI)

      expect(result).toHaveLength(2)
      expect(result[0]?.name).toBe('Ana Gómez')
      expect(result[1]?.name).toBe('Luis Romero')
      expect(result[1]?.phone).toBe('+58 424 9876543')
    })

    it('ignora el prefijo de grupo "item1." que Apple pone en campos etiquetados', () => {
      const vcf = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:María Silva',
        'item1.TEL:+56 9 8765 4321',
        'item1.X-ABLabel:Trabajo',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]?.phone).toBe('+56 9 8765 4321')
    })
  })

  describe('elección de teléfono', () => {
    it('prefiere el móvil sobre casa aunque casa venga primero', () => {
      const vcf = [
        'BEGIN:VCARD',
        'FN:Carlos Ruiz',
        'TEL;type=HOME:+58 212 5551234',
        'TEL;type=CELL:+58 414 5551234',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]?.phone).toBe('+58 414 5551234')
    })

    it('cae a PREF cuando no hay móvil', () => {
      const vcf = [
        'BEGIN:VCARD',
        'FN:Carlos Ruiz',
        'TEL;type=WORK:+58 212 1111111',
        'TEL;type=HOME;type=pref:+58 212 2222222',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]?.phone).toBe('+58 212 2222222')
    })

    it('cae al primero cuando no hay ni móvil ni PREF', () => {
      const vcf = [
        'BEGIN:VCARD',
        'FN:Carlos Ruiz',
        'TEL;type=WORK:+58 212 1111111',
        'TEL;type=OTHER:+58 212 2222222',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]?.phone).toBe('+58 212 1111111')
    })

    it('devuelve phone null cuando la ficha no tiene ningún teléfono', () => {
      const vcf = 'BEGIN:VCARD\nFN:Sin Teléfono\nEND:VCARD'

      expect(parseVCards(vcf)[0]).toEqual({ name: 'Sin Teléfono', phone: null, email: null })
    })
  })

  describe('compatibilidad entre versiones de vCard', () => {
    it('quita el esquema tel: de los valores 4.0', () => {
      const vcf = [
        'BEGIN:VCARD',
        'VERSION:4.0',
        'FN:Nora Díaz',
        'TEL;TYPE="cell":tel:+34-612-345-678',
        'EMAIL:mailto:nora@ejemplo.com',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]).toEqual({
        name:  'Nora Díaz',
        phone: '+34-612-345-678',
        email: 'nora@ejemplo.com',
      })
    })

    it('decodifica quoted-printable de exports 2.1 (acentos y ñ)', () => {
      const vcf = [
        'BEGIN:VCARD',
        'VERSION:2.1',
        'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Iba=C3=B1ez Mu=C3=B1oz',
        'TEL;CELL:+52 55 1234 5678',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]?.name).toBe('Ibañez Muñoz')
    })

    it('une las líneas partidas por el "=" final de quoted-printable', () => {
      const vcf = [
        'BEGIN:VCARD',
        'VERSION:2.1',
        'FN;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Mar=',
        '=C3=ADa Fern=C3=A1ndez',
        'TEL:+34 600 000 000',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]?.name).toBe('José María Fernández')
    })

    it('reconstruye el nombre desde N cuando no hay FN', () => {
      const vcf = [
        'BEGIN:VCARD',
        'VERSION:2.1',
        'N:Gómez;Ana;Lucía;Dra.;Jr.',
        'TEL:+57 300 0000000',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]?.name).toBe('Dra. Ana Lucía Gómez Jr.')
    })
  })

  describe('plegado, escapes y ruido', () => {
    it('deshace el plegado RFC (líneas continuadas con espacio)', () => {
      const vcf = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Bartolomé de las Casas y',
        '  Figueroa',
        'TEL;type=CELL:+34 611 222 333',
        'END:VCARD',
      ].join('\r\n')

      expect(parseVCards(vcf)[0]?.name).toBe('Bartolomé de las Casas y Figueroa')
    })

    it('no confunde el "=" final de un PHOTO base64 con un salto quoted-printable', () => {
      // Regresión: tratar todo "=" final como plegado QP se comía la línea
      // siguiente y dejaba la ficha sin teléfono.
      const vcf = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Con Foto',
        'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD=',
        'TEL;type=CELL:+58 412 0000000',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]).toEqual({
        name: 'Con Foto', phone: '+58 412 0000000', email: null,
      })
    })

    it('respeta las comas y puntos y coma escapados dentro del nombre', () => {
      const vcf = [
        'BEGIN:VCARD',
        'FN:Ruiz\\, S.A.\\; Sucursal',
        'TEL:+58 212 0000000',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]?.name).toBe('Ruiz, S.A.; Sucursal')
    })

    it('no parte los campos de N por un ";" escapado', () => {
      const vcf = [
        'BEGIN:VCARD',
        'N:Ruiz\\; Hermanos;Pedro;;;',
        'TEL:+58 212 0000000',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)[0]?.name).toBe('Pedro Ruiz; Hermanos')
    })
  })

  describe('entradas inservibles', () => {
    it('descarta fichas sin nombre y sin teléfono', () => {
      const vcf = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'EMAIL:solo@correo.com',
        'END:VCARD',
      ].join('\n')

      expect(parseVCards(vcf)).toEqual([])
    })

    it('devuelve lista vacía para un archivo que no es una vCard', () => {
      expect(parseVCards('esto no es una vcard')).toEqual([])
      expect(parseVCards('')).toEqual([])
    })

    it('ignora una ficha sin END:VCARD en vez de romper el archivo entero', () => {
      const vcf = [
        'BEGIN:VCARD',
        'FN:Completa',
        'TEL:+58 412 1111111',
        'END:VCARD',
        'BEGIN:VCARD',
        'FN:Truncada',
      ].join('\n')

      const result = parseVCards(vcf)

      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Completa')
    })
  })
})
