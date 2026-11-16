import { createApp } from 'vue';
import RootApp from './RootApp.vue';
import './assets/styles.css';
import { applyThemeToDocument, resolveEffectiveThemeId } from './utils/themes';

const AUTO_RELOAD_KEY = 'agenda_hmr_reload_at';

function tryRecoverReload(): boolean {
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) || 0);
    if (now - last > 5000) {
      sessionStorage.setItem(AUTO_RELOAD_KEY, String(now));
      window.location.reload();
      return true;
    }
  } catch {
    // Ignore sessionStorage errors in restricted environments.
  }
  return false;
}

function renderFallbackNotice(reason: string) {
  const mountEl = document.getElementById('app');
  if (!mountEl || mountEl.children.length > 0) return;
  mountEl.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;height:100vh;padding:24px;text-align:center;color:var(--text-primary,#e5e7eb);background:var(--app-bg,#07080a);font-family:var(--font-sans,system-ui,sans-serif);';
  const title = document.createElement('p');
  title.textContent = '界面热更新或渲染遇到异常，已触发保护拦截';
  title.style.cssText = 'margin:0;font-size:15px;font-weight:600;';
  const detail = document.createElement('p');
  detail.textContent = reason;
  detail.style.cssText = 'margin:0;max-width:460px;font-size:12px;opacity:0.72;word-break:break-word;';
  const btn = document.createElement('button');
  btn.textContent = '重新加载界面';
  btn.style.cssText = 'padding:8px 18px;border-radius:999px;border:1px solid var(--border-strong,rgba(255,255,255,0.2));background:var(--cta-bg,#ffffff);color:var(--cta-ink,#0b0d10);font-size:12px;font-weight:700;cursor:pointer;';
  btn.onclick = () => window.location.reload();
  box.append(title, detail, btn);
  mountEl.appendChild(box);
}

applyThemeToDocument(resolveEffectiveThemeId());

if (import.meta.hot) {
  import.meta.hot.on('vite:error', () => {
    tryRecoverReload();
  });
}

window.addEventListener('vite:preloadError', () => {
  tryRecoverReload();
});

const app = createApp(RootApp);

app.config.errorHandler = (err, _instance, info) => {
  console.error('Vue runtime error:', info, err);
  const message = err instanceof Error ? err.message : String(err);
  if (import.meta.env.DEV && tryRecoverReload()) return;
  renderFallbackNotice(message);
};

try {
  app.mount('#app');
} catch (err) {
  console.error('Failed to mount app:', err);
  const message = err instanceof Error ? err.message : String(err);
  if (!tryRecoverReload()) {
    renderFallbackNotice(message);
  }
}
