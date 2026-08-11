import { deleteExpiredLogs } from './repository.js';

export function startRetentionJob(): void {
  const retentionDays = Number(process.env.RETENTION_DAYS ?? '30');
  const intervalMinutes = Number(process.env.RETENTION_INTERVAL_MINUTES ?? '5');
  const batchSize = Number(process.env.RETENTION_BATCH_SIZE ?? '5000');

  setInterval(
    async () => {
      try {
        let totalDeleted = 0;
        let deletedInBatch: number;
        do {
          deletedInBatch = await deleteExpiredLogs(retentionDays, batchSize);
          totalDeleted += deletedInBatch;
        } while (deletedInBatch === batchSize);

        if (totalDeleted > 0) {
          console.log(`Retention: deleted ${totalDeleted} expired log(s)`);
        }
      } catch (err) {
        console.error('Retention job failed:', err);
      }
    },
    intervalMinutes * 60 * 1000,
  );
}
