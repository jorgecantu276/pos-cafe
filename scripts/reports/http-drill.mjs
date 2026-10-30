// Reuse the proven restore/production-preview lifecycle; add reporting fixtures
// only inside that owned disposable clone. No hosted configuration is loaded.
process.argv.push('--reports');
await import('../inventory/http-drill.mjs');
