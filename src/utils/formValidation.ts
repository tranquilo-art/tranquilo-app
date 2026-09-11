// Shared by every plain HTML form on the marketing pages -- each used to
// carry its own copy of these checks.

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_e) {
    return false;
  }
}

export function isNonEmpty(value: string): boolean {
  return !!value && value.trim().length > 0;
}

// Error styling applies to the wrapping `.field`/`.field-check`, matched
// by `data-field="<name>"`, not always the same as the control's own id.
export function fieldWrap(form: HTMLFormElement, name: string): Element | null {
  return form.querySelector(`[data-field="${name}"]`);
}

export function setFieldError(
  form: HTMLFormElement,
  name: string,
  hasError: boolean,
): void {
  const wrap = fieldWrap(form, name);
  if (wrap) wrap.classList.toggle("error", hasError);
}

export function clearFieldError(form: HTMLFormElement, name: string): void {
  setFieldError(form, name, false);
}
