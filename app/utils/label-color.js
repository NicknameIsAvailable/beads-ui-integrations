/**
 * Build inline style for label badges based on text.
 *
 * @param {string} label_text
 * @returns {string}
 */
export function labelColorStyle(label_text) {
  const normalized_text = String(label_text || '')
    .trim()
    .toLowerCase();
  if (!normalized_text) {
    return '';
  }

  const hash_value = hashString(normalized_text);
  const hue_value = hash_value % 360;
  const saturation_value = 62;
  const lightness_value = 48;

  return `--label-base: hsl(${hue_value} ${saturation_value}% ${lightness_value}%);`;
}

/**
 * @param {string} input_text
 * @returns {number}
 */
function hashString(input_text) {
  let hash_value = 2166136261;

  for (let index = 0; index < input_text.length; index += 1) {
    const code_point = input_text.charCodeAt(index);
    hash_value ^= code_point;
    hash_value +=
      (hash_value << 1) +
      (hash_value << 4) +
      (hash_value << 7) +
      (hash_value << 8) +
      (hash_value << 24);
    hash_value >>>= 0;
  }

  return hash_value >>> 0;
}
