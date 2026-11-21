export function handleComposerKeydown(event, generate) {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  generate();
}
