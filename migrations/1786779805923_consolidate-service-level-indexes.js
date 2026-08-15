export const shorthands = undefined;

export const up = (pgm) => {
  pgm.dropIndex('logs', ['service', 'timestamp']);
  pgm.dropIndex('logs', ['level', 'timestamp']);
  pgm.createIndex('logs', ['service', 'level', 'timestamp']);
};

export const down = (pgm) => {
  pgm.dropIndex('logs', ['service', 'level', 'timestamp']);
  pgm.createIndex('logs', ['service', 'timestamp']);
  pgm.createIndex('logs', ['level', 'timestamp']);
};