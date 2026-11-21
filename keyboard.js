export function consumeComposerText(input) {
  const text = input.value.trim();
  input.value = '';
  return text;
}

export function handleComposerKeydown(event, generate) {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  generate();
}
