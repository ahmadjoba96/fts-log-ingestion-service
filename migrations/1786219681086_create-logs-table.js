/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */

export const up = (pgm) => {
  pgm.createTable('logs', {
    id: { type: 'bigserial', primaryKey: true },
    timestamp: { type: 'timestamptz', notNull: true },
    level: { type: 'text', notNull: true },
    service: { type: 'text', notNull: true },
    message: { type: 'text', notNull: true },
    attributes: { type: 'jsonb', notNull: false },
  });

  pgm.createIndex('logs', ['service', 'timestamp']);
  pgm.createIndex('logs', ['level', 'timestamp']);
  pgm.createIndex('logs', 'attributes', { method: 'gin' });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('logs');
};
