export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createIndex('logs', ['service', 'timestamp']);
};

export const down = (pgm) => {
  pgm.dropIndex('logs', ['service', 'timestamp']);
};