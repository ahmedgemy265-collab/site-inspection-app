import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

function showFatalError(err: unknown) {
  const el = document.getElementById('root')
  if (!el) return
  const message = err instanceof Error ? (err.stack || err.message) : String(err)
  el.innerHTML = `
    <div style="direction:rtl;font-family:sans-serif;padding:24px;max-width:700px;margin:40px auto;background:#fff3f0;border:2px solid #c6432b;border-radius:8px;color:#111;">
      <h2 style="margin:0 0 12px;color:#c6432b;">حصل خطأ وقت تشغيل البرنامج</h2>
      <p style="margin:0 0 12px;">انسخ النص ده وابعته في المحادثة مع Claude:</p>
      <pre style="white-space:pre-wrap;background:#fff;padding:12px;border-radius:4px;border:1px solid #ddd;font-size:12px;direction:ltr;text-align:left;">${message.replace(/</g, '&lt;')}</pre>
    </div>
  `
}

window.addEventListener('error', (e) => showFatalError(e.error || e.message))
window.addEventListener('unhandledrejection', (e) => showFatalError(e.reason))

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (err) {
  showFatalError(err)
}
