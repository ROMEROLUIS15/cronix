import { describe, it, expect, vi, afterEach } from 'vitest';
import { isIOS } from './contact-picker.service';

/**
 * `isIOS()` decide si se muestra el hint de "Autorrellenar contacto" (la ruta
 * alternativa de Safari, ya que WebKit no expone la Contact Picker API).
 *
 * Los dos errores que este test existe para atrapar:
 *  1. Falso NEGATIVO en iPadOS 13+ → el usuario de iPad se queda sin ninguna
 *     ruta para importar contactos (ni botón ni hint).
 *  2. Falso POSITIVO en Android/escritorio → se muestra un hint que habla de
 *     una barra de teclado que ahí no existe. En Android además convive con el
 *     botón real, que sí funciona.
 *
 * Ver modulo-dashboard §9.
 */

/** User-agents reales, no inventados. */
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  ipadLegacy:
    'Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  ipodTouch:
    'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  /** iPadOS 13+ y macOS Safari comparten ESTE MISMO UA — solo los separa maxTouchPoints. */
  macintosh:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
} as const;

/** `isIOS()` solo lee estas dos propiedades, así que un objeto plano basta. */
function stubNavigator(userAgent: string, maxTouchPoints = 0): void {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints });
}

describe('isIOS', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('dispositivos iOS → true', () => {
    it('detecta iPhone con Safari', () => {
      stubNavigator(UA.iphoneSafari);
      expect(isIOS()).toBe(true);
    });

    // Todo navegador en iOS está obligado a usar WebKit, así que Chrome/iOS
    // sufre exactamente la misma limitación que Safari.
    it('detecta Chrome en iOS (CriOS), no solo Safari', () => {
      stubNavigator(UA.iphoneChrome);
      expect(isIOS()).toBe(true);
    });

    it('detecta iPad con UA clásico (pre-iPadOS 13)', () => {
      stubNavigator(UA.ipadLegacy);
      expect(isIOS()).toBe(true);
    });

    it('detecta iPod touch', () => {
      stubNavigator(UA.ipodTouch);
      expect(isIOS()).toBe(true);
    });
  });

  // iPadOS 13+ se hace pasar por Macintosh. El UA por sí solo NO alcanza:
  // la única señal que lo distingue de un Mac de escritorio es maxTouchPoints.
  describe('iPadOS 13+ vs. macOS de escritorio (mismo UA)', () => {
    it('con UA de Macintosh y pantalla táctil → es un iPad, true', () => {
      stubNavigator(UA.macintosh, 5);
      expect(isIOS()).toBe(true);
    });

    it('con UA de Macintosh y sin táctil → es un Mac, false', () => {
      stubNavigator(UA.macintosh, 0);
      expect(isIOS()).toBe(false);
    });
  });

  describe('no-iOS → false', () => {
    // Crítico: en Android el botón del picker SÍ funciona. Un true aquí
    // pintaría el hint junto a un botón que ya resuelve el problema.
    it('no confunde Android con iOS', () => {
      stubNavigator(UA.androidChrome);
      expect(isIOS()).toBe(false);
    });

    it('no confunde Chrome en Windows con iOS', () => {
      stubNavigator(UA.windowsChrome);
      expect(isIOS()).toBe(false);
    });

    // El escritorio táctil (portátil Windows con pantalla táctil) tiene
    // maxTouchPoints > 0 pero UA de Windows: no debe pasar el guard.
    it('no confunde un Windows táctil con un iPad', () => {
      stubNavigator(UA.windowsChrome, 10);
      expect(isIOS()).toBe(false);
    });
  });

  // El hook llama a isIOS() dentro de useEffect, pero el guard protege por si
  // alguien lo mueve al cuerpo del componente (se renderiza en el servidor).
  it('no revienta durante SSR, cuando no existe navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(() => isIOS()).not.toThrow();
    expect(isIOS()).toBe(false);
  });
});
