// Explore and the journal read the phone's time zone; pinning it keeps app tests the same on every machine.
export default function globalSetup() {
  process.env.TZ = "America/Los_Angeles";
}
