// The repository's Node 20 type package predates this Node 24 runtime API.
// Remove this narrow declaration when upgrading @types/node to 24 or later.
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(filename: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...values: (string | number | null)[]): { changes: number | bigint };
      get(...values: (string | number)[]): unknown;
      all(...values: (string | number)[]): unknown[];
    };
    close(): void;
  }
}
