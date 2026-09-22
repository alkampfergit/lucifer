import { createRequire } from 'node:module'
import { win32 } from 'node:path'
import type { WindowsStoreLocation } from '../types/tls_config.js'

/**
 * Native Windows certificate store access.
 *
 * This module is the only place that talks to the operating system. It binds
 * the CryptoAPI entry points in `crypt32.dll` directly — no PowerShell process
 * and no script text — through koffi, an FFI layer that ships prebuilt
 * binaries per platform, so installing Lucifer still needs no C toolchain.
 *
 * Everything above it (which certificate to pick, which intermediates to send)
 * is plain TypeScript over `node:crypto`, so it can be tested on any platform
 * against the small surface declared here.
 */

type Koffi = typeof import('koffi')

/** koffi hands back an opaque pointer value; it is never dereferenced outside this module. */
export type NativeCertificateHandle = NonNullable<unknown>

export interface WindowsStoreCertificate {
  /** DER bytes copied out of the store, ready for `new X509Certificate(...)`. */
  der: Buffer
  /** True when the store holds key provider info, i.e. a usable private key. */
  hasPrivateKey: boolean
  /** CryptoAPI certificate context; valid until passed to `release`. */
  handle: NativeCertificateHandle
}

/**
 * The slice of CryptoAPI the TLS code needs. Declared as an interface so the
 * selection and chain logic can be exercised with an in-memory double.
 */
export interface WindowsCryptoApi {
  /** Every certificate in one system store, with a handle the caller must release. */
  listCertificates(location: WindowsStoreLocation, storeName: string): WindowsStoreCertificate[]
  /** Pack the given certificates and their private keys into a PKCS#12 bundle. */
  exportPkcs12(certificates: readonly WindowsStoreCertificate[], passphrase: string): Buffer
  /** Free the CryptoAPI handles. Safe to call with certificates from several stores. */
  release(certificates: readonly WindowsStoreCertificate[]): void
}

// wincrypt.h constants. The store provider is an integer masquerading as a
// pointer, which is why it is declared as `uintptr_t` below.
const CERT_STORE_PROV_MEMORY = 2
const CERT_STORE_PROV_SYSTEM_W = 10
const CERT_SYSTEM_STORE_CURRENT_USER = 1 << 16
const CERT_SYSTEM_STORE_LOCAL_MACHINE = 2 << 16
const CERT_STORE_OPEN_EXISTING_FLAG = 0x4000
const CERT_STORE_READONLY_FLAG = 0x8000
const CERT_KEY_PROV_INFO_PROP_ID = 2
const CERT_STORE_ADD_ALWAYS = 4
const REPORT_NO_PRIVATE_KEY = 0x0001
const REPORT_NOT_ABLE_TO_EXPORT_PRIVATE_KEY = 0x0002
const EXPORT_PRIVATE_KEYS = 0x0004

const PFX_EXPORT_FLAGS =
  EXPORT_PRIVATE_KEYS | REPORT_NO_PRIVATE_KEY | REPORT_NOT_ABLE_TO_EXPORT_PRIVATE_KEY

/**
 * Both DLLs are loaded by absolute path under `%SystemRoot%` rather than by
 * name, so the Windows DLL search order cannot be redirected at a library that
 * would then be handed the private key.
 */
const DEFAULT_SYSTEM_ROOT = String.raw`C:\Windows`

function systemLibraryPath(fileName: string): string {
  return win32.join(process.env.SystemRoot || DEFAULT_SYSTEM_ROOT, 'System32', fileName)
}

type NativeCall = (...args: unknown[]) => unknown

interface Crypt32Bindings {
  koffi: Koffi
  certOpenStore: NativeCall
  certCloseStore: NativeCall
  certEnumCertificatesInStore: NativeCall
  certDuplicateCertificateContext: NativeCall
  certFreeCertificateContext: NativeCall
  certGetCertificateContextProperty: NativeCall
  certAddCertificateContextToStore: NativeCall
  pfxExportCertStoreEx: NativeCall
  getLastError: NativeCall
}

interface CertContextRecord {
  pbCertEncoded: NonNullable<unknown> | null
  cbCertEncoded: number
}

interface CryptDataBlob {
  cbData: number
  pbData: NonNullable<unknown> | null
}

let bindings: Crypt32Bindings | undefined

function requireKoffi(): Koffi {
  const requireModule = createRequire(import.meta.url)
  try {
    return requireModule('koffi') as Koffi
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `"tls.source": "windows-store" needs the "koffi" package to call the Windows certificate ` +
      `store, and it could not be loaded: ${reason}`,
    )
  }
}

function createBindings(): Crypt32Bindings {
  const koffi = requireKoffi()

  koffi.struct('LUCIFER_CERT_CONTEXT', {
    dwCertEncodingType: 'uint32_t',
    pbCertEncoded: 'void *',
    cbCertEncoded: 'uint32_t',
    pCertInfo: 'void *',
    hCertStore: 'void *',
  })
  koffi.struct('LUCIFER_CRYPT_DATA_BLOB', {
    cbData: 'uint32_t',
    pbData: 'void *',
  })

  const crypt32 = koffi.load(systemLibraryPath('crypt32.dll'))
  const kernel32 = koffi.load(systemLibraryPath('kernel32.dll'))

  return {
    koffi,
    certOpenStore: crypt32.func(
      'void * __stdcall CertOpenStore(uintptr_t lpszStoreProvider, uint32_t dwEncodingType, ' +
      'uintptr_t hCryptProv, uint32_t dwFlags, const char16_t *pvPara)',
    ),
    certCloseStore: crypt32.func('bool __stdcall CertCloseStore(void *hCertStore, uint32_t dwFlags)'),
    certEnumCertificatesInStore: crypt32.func(
      'void * __stdcall CertEnumCertificatesInStore(void *hCertStore, void *pPrevCertContext)',
    ),
    certDuplicateCertificateContext: crypt32.func(
      'void * __stdcall CertDuplicateCertificateContext(void *pCertContext)',
    ),
    certFreeCertificateContext: crypt32.func(
      'bool __stdcall CertFreeCertificateContext(void *pCertContext)',
    ),
    certGetCertificateContextProperty: crypt32.func(
      'bool __stdcall CertGetCertificateContextProperty(void *pCertContext, uint32_t dwPropId, ' +
      'void *pvData, _Inout_ uint32_t *pcbData)',
    ),
    certAddCertificateContextToStore: crypt32.func(
      'bool __stdcall CertAddCertificateContextToStore(void *hCertStore, void *pCertContext, ' +
      'uint32_t dwAddDisposition, void *ppStoreContext)',
    ),
    pfxExportCertStoreEx: crypt32.func(
      'bool __stdcall PFXExportCertStoreEx(void *hStore, _Inout_ LUCIFER_CRYPT_DATA_BLOB *pPFX, ' +
      'const char16_t *szPassword, void *pvPara, uint32_t dwFlags)',
    ),
    getLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
  }
}

/** Bindings are built once: koffi rejects a second `struct()` under the same name. */
function loadBindings(): Crypt32Bindings {
  bindings ??= createBindings()
  return bindings
}

/**
 * CryptoAPI reports failures through `GetLastError`, so the numeric code is the
 * only diagnostic available. `0x80092004` (object not found) and `0x8009000B`
 * (key not exportable) are the two an operator is most likely to hit.
 */
function lastErrorText(api: Crypt32Bindings): string {
  const code = Number(api.getLastError())
  return `Windows error 0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

function systemStoreFlags(location: WindowsStoreLocation): number {
  const root =
    location === 'CurrentUser' ? CERT_SYSTEM_STORE_CURRENT_USER : CERT_SYSTEM_STORE_LOCAL_MACHINE
  return root | CERT_STORE_READONLY_FLAG | CERT_STORE_OPEN_EXISTING_FLAG
}

function readDer(api: Crypt32Bindings, context: NonNullable<unknown>): Buffer {
  const record = api.koffi.decode(context, 'LUCIFER_CERT_CONTEXT') as CertContextRecord
  if (!record.pbCertEncoded || record.cbCertEncoded === 0) {
    return Buffer.alloc(0)
  }
  // `view` is a window onto unmanaged memory; copy before the context is freed.
  return Buffer.from(new Uint8Array(api.koffi.view(record.pbCertEncoded, record.cbCertEncoded)))
}

function hasKeyProviderInfo(api: Crypt32Bindings, context: NonNullable<unknown>): boolean {
  const size = [0]
  return Boolean(
    api.certGetCertificateContextProperty(context, CERT_KEY_PROV_INFO_PROP_ID, null, size),
  )
}

function listCertificates(
  location: WindowsStoreLocation,
  storeName: string,
): WindowsStoreCertificate[] {
  const api = loadBindings()
  const store = api.certOpenStore(
    CERT_STORE_PROV_SYSTEM_W,
    0,
    0,
    systemStoreFlags(location),
    storeName,
  )
  if (!store) {
    throw new Error(
      `Cannot open the Windows certificate store "${location}\\${storeName}": ${lastErrorText(api)}`,
    )
  }

  const certificates: WindowsStoreCertificate[] = []
  try {
    // CertEnumCertificatesInStore frees the context it was handed, so every
    // certificate worth keeping is duplicated before the next iteration.
    let context = api.certEnumCertificatesInStore(store, null)
    while (context) {
      const handle = api.certDuplicateCertificateContext(context)
      if (handle) {
        certificates.push({
          der: readDer(api, context),
          hasPrivateKey: hasKeyProviderInfo(api, context),
          handle,
        })
      }
      context = api.certEnumCertificatesInStore(store, context)
    }
  } catch (err) {
    release(certificates)
    throw err
  } finally {
    api.certCloseStore(store, 0)
  }

  return certificates
}

function exportPkcs12(
  certificates: readonly WindowsStoreCertificate[],
  passphrase: string,
): Buffer {
  const api = loadBindings()
  const memoryStore = api.certOpenStore(CERT_STORE_PROV_MEMORY, 0, 0, 0, null)
  if (!memoryStore) {
    throw new Error(`Cannot stage the certificate for export: ${lastErrorText(api)}`)
  }

  try {
    for (const certificate of certificates) {
      if (
        !api.certAddCertificateContextToStore(
          memoryStore,
          certificate.handle,
          CERT_STORE_ADD_ALWAYS,
          null,
        )
      ) {
        throw new Error(`Cannot stage the certificate for export: ${lastErrorText(api)}`)
      }
    }

    // PFXExportCertStoreEx is called twice: once with a null buffer to learn
    // the size, once to fill it.
    const sizing: CryptDataBlob = { cbData: 0, pbData: null }
    if (!api.pfxExportCertStoreEx(memoryStore, sizing, passphrase, null, PFX_EXPORT_FLAGS)) {
      throw new Error(
        `Windows certificate store export failed: ${lastErrorText(api)}. The private key must be ` +
        'marked exportable, and a LocalMachine store normally requires an elevated process.',
      )
    }
    if (sizing.cbData === 0) {
      throw new Error('Windows certificate store export returned no certificate data.')
    }

    // koffi.alloc rather than a Buffer: the address has to stay put across the
    // call, which is only guaranteed for memory koffi owns.
    const buffer = api.koffi.alloc('uint8_t', sizing.cbData) as NonNullable<unknown>
    try {
      const blob: CryptDataBlob = { cbData: sizing.cbData, pbData: buffer }
      if (!api.pfxExportCertStoreEx(memoryStore, blob, passphrase, null, PFX_EXPORT_FLAGS)) {
        throw new Error(`Windows certificate store export failed: ${lastErrorText(api)}`)
      }
      return Buffer.from(new Uint8Array(api.koffi.view(buffer, blob.cbData)))
    } finally {
      api.koffi.free(buffer)
    }
  } finally {
    api.certCloseStore(memoryStore, 0)
  }
}

function release(certificates: readonly WindowsStoreCertificate[]): void {
  const api = loadBindings()
  for (const certificate of certificates) {
    api.certFreeCertificateContext(certificate.handle)
  }
}

/**
 * Bind the CryptoAPI entry points. Called only on Windows, and only when
 * `"source": "windows-store"` is configured, so the FFI library is never
 * loaded on a host that cannot use it.
 */
export function loadWindowsCryptoApi(): WindowsCryptoApi {
  loadBindings()
  return { listCertificates, exportPkcs12, release }
}
