(function initializeAuth() {
  'use strict';

  const client = window.supabaseClient;
  const modal = document.getElementById('auth-modal');
  const dialog = modal.querySelector('.auth-dialog');
  const guest = document.getElementById('auth-guest');
  const authenticated = document.getElementById('auth-user');
  const displayName = document.getElementById('auth-display-name');
  const closeButtons = modal.querySelectorAll('[data-auth-close]');
  const toastRegion = document.getElementById('toast-region');
  let returnFocus = null;
  let recoveryMode = false;
  let activeRequest = false;
  let toastExitTimer = null;
  let toastRemoveTimer = null;

  const messages = {
    invalid_credentials: 'E-mail ou senha incorretos.',
    email_not_confirmed: 'Confirme seu e-mail antes de entrar.',
    user_already_exists: 'Não foi possível concluir o cadastro com esses dados.',
    weak_password: 'A senha não atende aos requisitos de segurança.',
    validation_failed: 'Verifique os dados informados e tente novamente.',
    over_email_send_rate_limit: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    session_not_found: 'Sua sessão expirou. Entre novamente.',
    refresh_token_not_found: 'Sua sessão expirou. Entre novamente.',
    network_error: 'Não foi possível conectar. Verifique sua internet e tente novamente.'
  };

  function friendlyError(error, fallback) {
    if (!error) return fallback;
    const code = String(error.code || '').toLowerCase();
    const text = String(error.message || '').toLowerCase();
    if (messages[code]) return messages[code];
    if (text.includes('invalid login credentials')) return messages.invalid_credentials;
    if (text.includes('email not confirmed')) return messages.email_not_confirmed;
    if (text.includes('already registered') || text.includes('already exists')) return messages.user_already_exists;
    if (text.includes('password')) return messages.weak_password;
    if (text.includes('rate limit') || error.status === 429) return messages.over_request_rate_limit;
    if (text.includes('fetch') || text.includes('network')) return messages.network_error;
    return fallback;
  }

  function setMessage(id, text, success = false) {
    const element = document.getElementById(id);
    element.textContent = text;
    element.classList.toggle('success', success);
    element.hidden = false;
  }

  function clearMessages() {
    modal.querySelectorAll('.auth-message').forEach((element) => {
      element.textContent = '';
      element.classList.remove('success');
      element.hidden = true;
    });
    modal.querySelectorAll('.auth-input').forEach((input) => input.removeAttribute('aria-invalid'));
  }

  function setLoading(form, loading) {
    activeRequest = loading;
    const button = form.querySelector('[type="submit"]');
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
    form.querySelectorAll('input').forEach((input) => { input.disabled = loading; });
  }

  function resetPasswordVisibility() {
    modal.querySelectorAll('[data-password-toggle]').forEach((button) => {
      const input = document.getElementById(button.getAttribute('aria-controls'));
      if (input) input.type = 'password';
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Mostrar senha');
    });
  }

  function showView(view) {
    clearMessages();
    resetPasswordVisibility();
    modal.querySelectorAll('[data-auth-view]').forEach((element) => {
      element.hidden = element.dataset.authView !== view;
    });
    const title = modal.querySelector(`[data-auth-view="${view}"] h2`);
    title.id = `auth-title-${view}`;
    dialog.setAttribute('aria-labelledby', title.id);
    window.requestAnimationFrame(() => {
      modal.querySelector(`[data-auth-view="${view}"] input`)?.focus();
    });
  }

  function openModal(view, trigger = document.activeElement) {
    returnFocus = trigger;
    modal.hidden = false;
    document.body.classList.add('auth-modal-open');
    showView(view);
  }

  function closeModal() {
    if (activeRequest || recoveryMode) return;
    modal.hidden = true;
    document.body.classList.remove('auth-modal-open');
    returnFocus?.focus();
  }

  function renderSession(session) {
    const user = session?.user;
    guest.hidden = Boolean(user);
    authenticated.hidden = !user;
    if (user) {
      const fallback = (user.email || 'Usuário').split('@')[0];
      displayName.textContent = user.user_metadata?.display_name || fallback;
    } else {
      displayName.textContent = '';
    }
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validate(input, condition) {
    input.setAttribute('aria-invalid', String(!condition));
    return condition;
  }

  function clearAuthParameters() {
    const url = new URL(window.location.href);
    ['code', 'error', 'error_code', 'error_description', 'type'].forEach((parameter) => {
      url.searchParams.delete(parameter);
    });
    url.hash = '';
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
  }

  function showToast(message, type = 'info') {
    const allowedTypes = ['success', 'error', 'info'];
    const safeType = allowedTypes.includes(type) ? type : 'info';
    window.clearTimeout(toastExitTimer);
    window.clearTimeout(toastRemoveTimer);
    toastRegion.replaceChildren();

    const toast = document.createElement('div');
    toast.className = `toast ${safeType}`;
    toast.textContent = message;
    toastRegion.appendChild(toast);

    toastExitTimer = window.setTimeout(() => {
      toast.classList.add('is-leaving');
    }, 3650);
    toastRemoveTimer = window.setTimeout(() => {
      if (toast.isConnected) toast.remove();
    }, 4000);
  }

  window.showToast = showToast;

  modal.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.getAttribute('aria-controls'));
      if (!input) return;
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
    });
  });

  document.querySelectorAll('[data-auth-open]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!client) {
        openModal('login', button);
        setMessage('login-message', 'A autenticação ainda precisa da URL e da Publishable Key do Supabase.');
        return;
      }
      openModal(button.dataset.authOpen, button);
    });
  });

  document.querySelectorAll('[data-auth-nav]').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.authNav));
  });
  closeButtons.forEach((button) => button.addEventListener('click', closeModal));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
    if (event.key === 'Tab' && !modal.hidden) {
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')].filter((item) => item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  document.getElementById('signup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || activeRequest) return;
    const form = event.currentTarget;
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const confirm = form.elements.confirm.value;
    clearMessages();
    const valid = [
      validate(form.elements.name, Boolean(name)),
      validate(form.elements.email, validEmail(email)),
      validate(form.elements.password, password.length >= 6),
      validate(form.elements.confirm, password === confirm && Boolean(confirm))
    ].every(Boolean);
    if (!valid) {
      setMessage('signup-message', password !== confirm ? 'As senhas não coincidem.' : 'Preencha os campos corretamente.');
      return;
    }
    setLoading(form, true);
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name },
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`
      }
    });
    setLoading(form, false);
    form.elements.password.value = '';
    form.elements.confirm.value = '';
    if (error) {
      setMessage('signup-message', friendlyError(error, 'Não foi possível criar a conta. Tente novamente.'));
      return;
    }
    if (!data.session) {
      setMessage('signup-message', 'Cadastro realizado. Verifique seu e-mail para confirmar sua conta.', true);
      return;
    }
    form.reset();
    renderSession(data.session);
    modal.hidden = true;
    document.body.classList.remove('auth-modal-open');
  });

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || activeRequest) return;
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    clearMessages();
    if (![validate(form.elements.email, validEmail(email)), validate(form.elements.password, Boolean(password))].every(Boolean)) {
      setMessage('login-message', 'Informe um e-mail válido e sua senha.');
      return;
    }
    setLoading(form, true);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    setLoading(form, false);
    form.elements.password.value = '';
    if (error) {
      setMessage('login-message', friendlyError(error, 'Não foi possível entrar. Tente novamente.'));
      return;
    }
    form.reset();
    renderSession(data.session);
    modal.hidden = true;
    document.body.classList.remove('auth-modal-open');
  });

  document.getElementById('recover-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || activeRequest) return;
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    clearMessages();
    if (!validate(form.elements.email, validEmail(email))) {
      setMessage('recover-message', 'Informe um e-mail válido.');
      return;
    }
    setLoading(form, true);
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname}`
    });
    setLoading(form, false);
    if (error) {
      const errorText = String(error.message || '').toLowerCase();
      if (error.status === 429 || errorText.includes('rate') || errorText.includes('fetch') || errorText.includes('network')) {
        setMessage('recover-message', friendlyError(error, 'Não foi possível enviar as instruções. Tente novamente.'));
        return;
      }
    }
    form.reset();
    setMessage('recover-message', 'Se existir uma conta associada a este e-mail, você receberá as instruções.', true);
  });

  document.getElementById('update-password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || activeRequest) return;
    const form = event.currentTarget;
    const password = form.elements.password.value;
    const confirm = form.elements.confirm.value;
    clearMessages();
    if (![validate(form.elements.password, password.length >= 6), validate(form.elements.confirm, password === confirm && Boolean(confirm))].every(Boolean)) {
      setMessage('update-message', password !== confirm ? 'As senhas não coincidem.' : 'A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    setLoading(form, true);
    const { error } = await client.auth.updateUser({ password });
    setLoading(form, false);
    form.reset();
    if (error) {
      setMessage('update-message', friendlyError(error, 'Não foi possível atualizar sua senha. Solicite um novo link.'));
      return;
    }
    recoveryMode = false;
    setMessage('update-message', 'Senha atualizada com sucesso.', true);
    clearAuthParameters();
    window.setTimeout(() => {
      modal.hidden = true;
      document.body.classList.remove('auth-modal-open');
    }, 1200);
  });

  document.getElementById('auth-signout').addEventListener('click', async (event) => {
    if (!client || activeRequest) return;
    const button = event.currentTarget;
    activeRequest = true;
    button.disabled = true;
    const { error } = await client.auth.signOut();
    activeRequest = false;
    button.disabled = false;
    if (!error) {
      renderSession(null);
      showToast('Até logo! Você saiu da sua conta com segurança.', 'success');
      return;
    }
    showToast('Não foi possível sair da sua conta. Tente novamente.', 'error');
  });

  if (!client) {
    renderSession(null);
    return;
  }

  client.auth.onAuthStateChange((event, session) => {
    renderSession(session);
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      window.setTimeout(() => openModal('update'), 0);
    }
  });

  client.auth.getSession().then(({ data, error }) => {
    if (!error) renderSession(data.session);
  });
})();
