export const INPUT_HELP = {
  vehicles:
    "Number of active vehicles sampled per tick. More vehicles create more rows and database load. Per-row mode allows at most 50. The slider and number field control the same count.",
  interval:
    "Seconds between scheduled ticks, and the movement time step for each sample. Smaller values write more often. Burst runs continuously, so this field is disabled and ignored.",
  maxRows:
    "Stops the run when either selected database reaches this many inserted rows in the current run. The final tick can exceed the limit by one batch. Existing database rows are not counted.",
  maxMinutes:
    "Maximum real elapsed run time in minutes. The simulator requests a stop when this limit is reached; an in-progress tick finishes first.",
  strategy:
    "Batch groups up to 500 rows into one INSERT. Per row sends one INSERT per record. Burst sends batches continuously without a scheduled wait, increasing database load.",
  pg: "Writes the generated samples into telemetry_pg, the standard PostgreSQL table. Turning this off removes that destination from the next run; history remains visible.",
  ts: "Writes identical generated samples into telemetry_ts, the TimescaleDB hypertable. Turning this off removes that destination from the next run; history remains visible.",
  dirty:
    "Adds approximately 2% late records with timestamps 1 minute to 24 hours earlier, and approximately 1% duplicate rows. Conflicting duplicates are skipped by the INSERT. This is separate from warning scenarios.",
  password:
    "Simulator access password used to authorize initialization and writes. It must match the configured simulator password and does not change the generated data.",
  scenarios:
    "Enables persistent abnormal telemetry for future warning reports. Turning it off generates baseline telemetry. Late and duplicate records are controlled separately.",
  speeding:
    "Creates speeding episodes lasting 20-90 seconds. Speed exceeds the configured limit and affects the vehicle's movement distance.",
  longStop:
    "Keeps a vehicle's speed at zero and its position stationary for the stop-warning duration plus another 2-10 minutes. Warnings begin only after the threshold has elapsed in telemetry time.",
  altitude:
    "Generates altitude readings above the configured threshold or below zero for 20-90 seconds. Latitude and longitude continue to follow the vehicle's route.",
  poorGps:
    "Generates a large GPS error radius for 20-90 seconds. A larger gps_accuracy_m value means less accurate positioning; it does not move the recorded coordinates.",
  chancePercent:
    "Probability that an eligible vehicle starts a new incident each tick. One enabled scenario is chosen randomly. Active incidents persist until their end time. More frequent ticks create more opportunities; 0 prevents new incidents.",
  speedLimit:
    "Speed threshold in km/h used for warnings and generating speeding episodes. Incident speeds are 10-50 km/h higher, capped at 200 km/h. This is a simulated threshold, not a road-specific speed limit.",
  stopMinutes:
    "Minutes of continuous speed at or below 1 km/h before a long-stop warning appears. Generated stops last longer than this. Burst produces more samples but does not accelerate the elapsed stop duration.",
  altitudeLimit:
    "Upper altitude warning threshold in metres. Extreme-altitude episodes exceed this by 100-2,000 metres, capped at 9,000 m, or produce negative readings. Any below-zero altitude also counts as a warning.",
  gpsLimit:
    "GPS error-radius warning threshold in metres. Poor-GPS episodes add 25-500 metres above this threshold. Larger values mean worse accuracy, so raising this threshold makes warnings less sensitive.",
} as const;
