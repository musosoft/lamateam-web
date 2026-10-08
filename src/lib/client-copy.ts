/** Interaction copy is rendered into the page; no translation service or DOM scan. */
export function clientTranslator(element: HTMLElement | null) {
  const copy: Record<string, string> = JSON.parse(
    element?.dataset.copy || "{}",
  );
  return (key: string, values: Record<string, string | number> = {}) => {
    let text = copy[key];
    if (!text) throw new Error(`Missing interaction copy: ${key}`);
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  };
}
