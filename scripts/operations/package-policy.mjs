// Repository-only synthetic access never enters an installed customer build.
export function operationsDemoFile(relative) {
  return /^(?:app\/ops-demo(?:\/|$)|app\/api\/ops-demo(?:\/|$)|scripts\/operations(?:\/|$)|lib\/operations-demo\.mjs$|tests\/operations-demo\.test\.ts$)/.test(relative.replaceAll('\\', '/'));
}
