"""Server-only Gemini credentials. Local Windows secrets are protected by DPAPI."""
import ctypes
import os
from functools import lru_cache
from pathlib import Path


def _crypt(raw, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('Use APMERIN_GEMINI_KEY on this server')
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.windll.crypt32
    crypt.CryptProtectData.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    ctypes.windll.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    ctypes.windll.kernel32.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        ok = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        ok = crypt.CryptProtectData(ctypes.byref(source), 'AP Merin workflow Gemini', None, None, None, 1, ctypes.byref(target))
    if not ok:
        raise RuntimeError('Could not unlock or save the local Gemini credential')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


@lru_cache(maxsize=8)
def _read(path, modified):
    return _crypt(Path(path).read_bytes(), decrypt=True).decode('utf-8')


def key(store):
    configured = os.environ.get('APMERIN_GEMINI_KEY', '').strip()
    if configured:
        return configured
    if getattr(store,'is_cloud',False):return ''
    path = store.directory / 'gemini-key.dpapi'
    if path.exists() and os.name == 'nt':
        return _read(str(path.resolve()), path.stat().st_mtime_ns)
    return ''


def save_local(store, value):
    """Called by local setup only; never expose this credential through HTTP."""
    path = store.directory / 'gemini-key.dpapi'
    encrypted = _crypt(value.strip().encode('utf-8'))
    temporary = path.with_suffix('.tmp')
    temporary.write_bytes(encrypted)
    temporary.replace(path)
    _read.cache_clear()
