import React from "react";
const paths = {
  bolt: "m13 2-9 12h7l-1 8 10-12h-7l1-8Z",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  simulator: "M4 16V8l8-4 8 4v8l-8 4-8-4ZM4 8l8 4 8-4M12 12v8",
  sql: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16",
  database:
    "M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3ZM4 6v12c0 2 4 3 8 3s8-1 8-3V6M4 12c0 2 4 3 8 3s8-1 8-3",
  clock: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1",
  warning: "m12 3 10 18H2L12 3ZM12 9v5m0 3v1",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  chart: "M3 3v18h18M6 15l4-5 4 3 6-8",
  check: "m5 12 4 4L19 6",
  play: "m7 4 14 8-14 8V4Z",
  stop: "M5 5h14v14H5V5Z",
} as const;
export function Icon({
  name,
  className = "",
}: {
  name: keyof typeof paths;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
