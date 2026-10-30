export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production'
    && process.env.NEXT_PHASE !== 'phase-production-build' && process.env.POS_BACKUP_DIR) {
    const { startBusinessBackupScheduler } = await import('./lib/business-backup-server');
    startBusinessBackupScheduler();
  }
}
