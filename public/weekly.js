(() => {
  const form = document.getElementById('weekly-form');
  const content = document.getElementById('weekly-content');
  const error = document.getElementById('weekly-error');
  const cipherEl = document.getElementById('weekly-cipher');
  const devSecret = document.querySelector('weekly-secret');
  const KEY = 'utr-weekly-password';

  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  function reveal(html) {
    content.innerHTML = html;
    form.parentElement.hidden = true;
    document.dispatchEvent(new CustomEvent('weekly:ready'));
    const target = location.hash && document.getElementById(location.hash.slice(1));
    (target || content).scrollIntoView?.();
  }

  async function decrypt(password) {
    const c = JSON.parse(cipherEl.textContent);
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(c.salt), iterations: c.iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(c.iv) }, key, bytes(c.data));
    return new TextDecoder().decode(plain);
  }

  // `npm run dev` skips encryption, so show drafts directly on your own machine.
  if (devSecret) { reveal(devSecret.innerHTML); devSecret.remove(); return; }

  const remembered = (() => { try { return sessionStorage.getItem(KEY); } catch { return null; } })();
  if (remembered) decrypt(remembered).then(reveal).catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const password = document.getElementById('weekly-password').value;
    try {
      reveal(await decrypt(password));
      try { sessionStorage.setItem(KEY, password); } catch {}
    } catch {
      error.hidden = false;
    }
  });
})();
