/**
 * components/ui/vcard-import.tsx — .vcf import route (iOS + desktop).
 *
 * Route B of modulo-dashboard §9: the only way to reach an iPhone's address
 * book from a web page. The parser has its own unit tests; what is exercised
 * here is the wiring nobody had covered — file in, form-shaped contact out,
 * including the country split that must land identically to the Android picker.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VCardImport } from '@/components/ui/vcard-import'

/** What iOS 17 Contacts actually writes: 3.0, `item1.` group prefixes, typed TEL. */
const IOS_CARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Pérez;María;;;',
  'FN:María Pérez',
  'item1.TEL;type=CELL;type=VOICE;type=pref:+58 412-555-0134',
  'item1.X-ABLabel:iPhone',
  'EMAIL;type=INTERNET;type=HOME;type=pref:maria@example.com',
  'END:VCARD',
].join('\r\n')

const TWO_CARDS = [
  IOS_CARD,
  [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Carlos Rivas',
    'TEL;type=CELL:+1 (212) 555-9876',
    'END:VCARD',
  ].join('\r\n'),
].join('\r\n')

function vcfFile(content: string, name = 'contacto.vcf'): File {
  return new File([content], name, { type: 'text/vcard' })
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('file input not rendered')
  return input as HTMLInputElement
}

/** The user picking a file from the iOS Files app / a desktop dialog. */
function pickFile(container: HTMLElement, file: File) {
  fireEvent.change(fileInput(container), { target: { files: [file] } })
}

describe('VCardImport', () => {
  const onPick = vi.fn()

  beforeEach(() => { onPick.mockReset() })

  it('renders the import button', () => {
    render(<VCardImport onPick={onPick} />)
    expect(
      screen.getByRole('button', { name: /importar desde archivo de contacto/i }),
    ).toBeInTheDocument()
  })

  it('keeps the accept list scoped to what maps onto public.vcard (§9.3 nº6)', () => {
    const { container } = render(<VCardImport onPick={onPick} />)
    expect(fileInput(container).accept).toBe('.vcf,.vcard,text/vcard')
  })

  describe('help text', () => {
    it('tells iPhone users how to find the card once Files opens', () => {
      render(<VCardImport onPick={onPick} isIos />)
      // The export steps alone left users stranded in a folder full of
      // unrelated files, so naming the search is the point of the copy.
      expect(screen.getByText(/Guardar en Archivos/i)).toBeInTheDocument()
      expect(screen.getByText(/buscador/i)).toBeInTheDocument()
    })

    it('gives desktop users the plain .vcf wording instead', () => {
      render(<VCardImport onPick={onPick} />)
      expect(screen.getByText(/archivo \.vcf exportado/i)).toBeInTheDocument()
      expect(screen.queryByText(/Guardar en Archivos/i)).not.toBeInTheDocument()
    })
  })

  it('turns a single iOS card into form-ready fields', async () => {
    const { container } = render(<VCardImport onPick={onPick} isIos />)
    pickFile(container, vcfFile(IOS_CARD))

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
    expect(onPick).toHaveBeenCalledWith({
      name:       'María Pérez',
      phoneLocal: '4125550134',
      country:    expect.objectContaining({ code: 'VE', dial: '+58' }),
      email:      'maria@example.com',
    })
  })

  it('skips the chooser when the file holds one card', async () => {
    const { container } = render(<VCardImport onPick={onPick} />)
    pickFile(container, vcfFile(IOS_CARD))

    await waitFor(() => expect(onPick).toHaveBeenCalled())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('lets the user choose when a shared file holds several cards', async () => {
    const { container } = render(<VCardImport onPick={onPick} isIos />)
    pickFile(container, vcfFile(TWO_CARDS, 'contactos.vcf'))

    // Several cards in one file is the iOS/desktop-only edge the Android
    // picker cannot reach (multiple: false), so nothing is picked yet.
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())
    expect(onPick).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('option', { name: /Carlos Rivas/ }))

    expect(onPick).toHaveBeenCalledWith({
      name:       'Carlos Rivas',
      phoneLocal: '2125559876',
      country:    expect.objectContaining({ code: 'US', dial: '+1' }),
      email:      null,
    })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('dismisses the chooser without picking anything', async () => {
    const { container } = render(<VCardImport onPick={onPick} />)
    pickFile(container, vcfFile(TWO_CARDS))

    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('re-picking the same file still fires a change event', async () => {
    const { container } = render(<VCardImport onPick={onPick} />)
    pickFile(container, vcfFile(IOS_CARD))

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
    expect(fileInput(container).value).toBe('')
  })

  describe('rejected files', () => {
    it('reports a file with no usable card', async () => {
      const { container } = render(<VCardImport onPick={onPick} />)
      pickFile(container, vcfFile('no soy una vcard', 'notas.txt'))

      await waitFor(() =>
        expect(screen.getByText(/no contiene ningún contacto utilizable/i)).toBeInTheDocument(),
      )
      expect(onPick).not.toHaveBeenCalled()
    })

    it('reports a file over the size cap without reading it', async () => {
      const file = vcfFile(IOS_CARD)
      Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 })
      const read = vi.spyOn(file, 'text')

      const { container } = render(<VCardImport onPick={onPick} />)
      pickFile(container, file)

      await waitFor(() => expect(screen.getByText(/demasiado grande/i)).toBeInTheDocument())
      expect(read).not.toHaveBeenCalled()
      expect(onPick).not.toHaveBeenCalled()
    })

    it('reports a file the browser could not read', async () => {
      const file = vcfFile(IOS_CARD)
      Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('io')) })

      const { container } = render(<VCardImport onPick={onPick} />)
      pickFile(container, file)

      await waitFor(() => expect(screen.getByText(/no se pudo leer/i)).toBeInTheDocument())
      expect(onPick).not.toHaveBeenCalled()
    })
  })
})
