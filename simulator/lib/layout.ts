// Relative percentages of the space available between resize handles.
// Reset sizes restores these defaults. Values in each group should total 100.
export const DEFAULT_LAYOUT = {
  workspace: [20, 50, 30], // Controls | comparison reports and chart | SQL activity
  reportsAndChart: [45, 55], // Database reports above | latency chart below
  databaseReports: [50, 50], // PostgreSQL left | TimescaleDB right
  sqlHistory: [50, 50], // PostgreSQL above | TimescaleDB below
};
